/**
 * ssh/sftpClient.ts
 *
 * Envuelve la librería `ssh2` para:
 *   1. Conectarse a un servidor remoto del cliente (por contraseña o llave privada).
 *   2. Mapear el árbol de directorios vía SFTP para el explorador de archivos del frontend.
 *   3. Leer y escribir archivos SIN cargarlos completos en memoria del backend
 *      (streaming directo servidor-remoto <-> navegador).
 *
 * Nota de seguridad: este módulo nunca decide si una credencial es válida para
 * guardarse; solo recibe credenciales YA descifradas por el llamador (ver
 * vault/crypto.ts) y las usa para una conexión efímera. Las credenciales no
 * se loguean ni se persisten aquí.
 */

import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
import type { Readable, Writable } from "stream";

export interface ServerCredentials {
  host: string;
  port: number;
  username: string;
  /** Uno de los dos: contraseña o llave privada ya descifrada en memoria. */
  password?: string;
  privateKey?: string;
  passphrase?: string;
  /** Timeout de conexión en ms. */
  readyTimeout?: number;
}

export interface RemoteNode {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
  /** Permisos POSIX en octal, p.ej. "644", para no romper chmod al escribir. */
  mode: string;
  modifiedAt: Date;
  children?: RemoteNode[];
}

export class SftpConnectionError extends Error {
  constructor(host: string, cause: unknown) {
    super(`No se pudo conectar a ${host}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "SftpConnectionError";
  }
}

/**
 * Representa UNA sesión SSH/SFTP activa. Vida corta: se abre para una
 * operación (o una sesión de edición) y se cierra explícitamente con close().
 */
export class RemoteServerSession {
  private constructor(
    private readonly conn: Client,
    private readonly sftp: SFTPWrapper,
    readonly host: string
  ) {}

  static connect(creds: ServerCredentials): Promise<RemoteServerSession> {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      const connectConfig: ConnectConfig = {
        host: creds.host,
        port: creds.port,
        username: creds.username,
        readyTimeout: creds.readyTimeout ?? 10_000,
        // Nunca ambas a la vez; la llave privada tiene prioridad si está presente.
        ...(creds.privateKey
          ? { privateKey: creds.privateKey, passphrase: creds.passphrase }
          : { password: creds.password }),
      };

      conn
        .on("ready", () => {
          conn.sftp((err, sftp) => {
            if (err) {
              conn.end();
              return reject(new SftpConnectionError(creds.host, err));
            }
            resolve(new RemoteServerSession(conn, sftp, creds.host));
          });
        })
        .on("error", (err) => reject(new SftpConnectionError(creds.host, err)))
        .connect(connectConfig);
    });
  }

  /**
   * Recorre recursivamente un directorio remoto y arma el árbol para el
   * explorador de archivos del frontend. `maxDepth` evita recorrer árboles
   * enormes (p.ej. node_modules) de forma descontrolada.
   */
  async buildTree(remotePath: string, maxDepth = 6): Promise<RemoteNode> {
    const stat = await this.stat(remotePath);
    const name = remotePath.split("/").filter(Boolean).pop() ?? remotePath;

    const node: RemoteNode = {
      name,
      path: remotePath,
      type: stat.type,
      size: stat.size,
      mode: stat.mode,
      modifiedAt: stat.modifiedAt,
    };

    if (stat.type === "directory" && maxDepth > 0) {
      const entries = await this.readdir(remotePath);
      node.children = await Promise.all(
        entries
          .filter((e) => e.filename !== "." && e.filename !== "..")
          .map((e) => this.buildTree(joinRemotePath(remotePath, e.filename), maxDepth - 1))
      );
    }
    return node;
  }

  private readdir(remotePath: string): Promise<import("ssh2").FileEntry[]> {
    return new Promise((resolve, reject) => {
      this.sftp.readdir(remotePath, (err, list) => (err ? reject(err) : resolve(list)));
    });
  }

  private stat(remotePath: string): Promise<{ type: RemoteNode["type"]; size: number; mode: string; modifiedAt: Date }> {
    return new Promise((resolve, reject) => {
      this.sftp.stat(remotePath, (err, stats) => {
        if (err) return reject(err);
        resolve({
          type: stats.isDirectory() ? "directory" : stats.isSymbolicLink() ? "symlink" : "file",
          size: stats.size,
          mode: (stats.mode & 0o777).toString(8).padStart(3, "0"),
          modifiedAt: new Date(stats.mtime * 1000),
        });
      });
    });
  }

  /**
   * Abre un stream de LECTURA del archivo remoto. El llamador debe hacer
   * `.pipe()` directo hacia la respuesta HTTP: el archivo nunca se acumula
   * completo en un Buffer del backend, sin importar su tamaño.
   */
  createReadStream(remotePath: string): Readable {
    return this.sftp.createReadStream(remotePath, { autoClose: true });
  }

  /**
   * Abre un stream de ESCRITURA hacia el archivo remoto, preservando el modo
   * (permisos) que ya tenía, para no romper chmod del servidor del cliente.
   */
  async createWriteStream(remotePath: string): Promise<Writable> {
    const existing = await this.stat(remotePath).catch(() => null);
    return this.sftp.createWriteStream(remotePath, {
      mode: existing ? parseInt(existing.mode, 8) : 0o644,
    });
  }

  /** Atajo para cuando SÍ conviene el contenido completo (archivos de código, típicamente pequeños). */
  readFile(remotePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = this.createReadStream(remotePath);
      stream.on("data", (c) => chunks.push(Buffer.from(c)));
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  }

  writeFile(remotePath: string, content: string): Promise<void> {
    return this.createWriteStream(remotePath).then(
      (stream) =>
        new Promise((resolve, reject) => {
          stream.on("error", reject);
          stream.end(content, "utf8", () => resolve());
        })
    );
  }

  close(): void {
    this.conn.end();
  }
}

function joinRemotePath(base: string, name: string): string {
  return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`;
}
