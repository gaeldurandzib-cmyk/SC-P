/**
 * Servidor SSH real (no un mock) que corre en memoria, usado SOLO en las
 * pruebas para simular "el servidor remoto del cliente" sin depender de
 * ninguna red externa. Implementa el subsistema SFTP mínimo necesario para
 * validar RemoteServerSession contra un servidor SSH de verdad.
 */
import { Server, utils, type SFTPStream } from "ssh2";
import fs from "node:fs";
import path from "node:path";

const { STATUS_CODE: SFTP_STATUS_CODE, OPEN_MODE: SFTP_OPEN_MODE } = utils.sftp;

const TEST_USER = "deploy";
const TEST_PASSWORD = "s3cr3t-para-pruebas";

export function startFakeSshServer(rootDir: string, port = 0): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = new Server(
      { hostKeys: [fs.readFileSync(path.join(__dirname, "fixtures/host_key"))] },
      (client) => {
        client
          .on("authentication", (ctx) => {
            if (ctx.method === "password" && ctx.username === TEST_USER && ctx.password === TEST_PASSWORD) {
              return ctx.accept();
            }
            ctx.reject();
          })
          .on("ready", () => {
            client.on("session", (accept) => {
              const session = accept();
              session.on("sftp", (accept2: () => SFTPStream) => {
                const sftp = accept2();
                registerSftpHandlers(sftp, rootDir);
              });
            });
          });
      }
    );

    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : port;
      resolve({ port: boundPort, close: () => server.close() });
    });
  });
}

export const FAKE_SERVER_CREDS = { username: TEST_USER, password: TEST_PASSWORD };

/** Traduce las operaciones SFTP mínimas (stat, readdir, open/read/write/close) a fs real, dentro de rootDir. */
function registerSftpHandlers(sftp: SFTPStream, rootDir: string) {
  const handles = new Map<number, { fd: number; kind: "file" | "dir"; entries?: fs.Dirent[]; offset: number }>();
  let nextHandle = 0;

  const resolvePath = (p: string) => path.join(rootDir, path.relative("/", p.startsWith("/") ? p : `/${p}`));

  sftp.on("STAT", (reqId, remotePath) => {
    try {
      const stats = fs.statSync(resolvePath(remotePath));
      sftp.attrs(reqId, stats);
    } catch {
      sftp.status(reqId, SFTP_STATUS_CODE.NO_SUCH_FILE);
    }
  });

  sftp.on("OPENDIR", (reqId, remotePath) => {
    try {
      const entries = fs.readdirSync(resolvePath(remotePath), { withFileTypes: true });
      const h = nextHandle++;
      handles.set(h, { fd: -1, kind: "dir", entries, offset: 0 });
      const buf = Buffer.alloc(4);
      buf.writeUInt32BE(h, 0);
      sftp.handle(reqId, buf);
    } catch {
      sftp.status(reqId, SFTP_STATUS_CODE.NO_SUCH_FILE);
    }
  });

  sftp.on("READDIR", (reqId, handleBuf) => {
    const h = handles.get(handleBuf.readUInt32BE(0));
    if (!h || !h.entries || h.offset >= h.entries.length) {
      sftp.status(reqId, SFTP_STATUS_CODE.EOF);
      return;
    }
    const batch = h.entries.slice(h.offset, h.offset + 50);
    h.offset += batch.length;
    const names = batch.map((entry) => {
      const full = path.join(rootDir === entry.parentPath ? "" : "", entry.name);
      const stats = fs.statSync(path.join(entry.path ?? rootDir, entry.name));
      return { filename: entry.name, longname: entry.name, attrs: stats };
    });
    sftp.name(reqId, names);
  });

  sftp.on("OPEN", (reqId, remotePath, flags) => {
    try {
      const isWrite = !!(flags & SFTP_OPEN_MODE.WRITE);
      const fd = fs.openSync(resolvePath(remotePath), isWrite ? "w" : "r");
      const h = nextHandle++;
      handles.set(h, { fd, kind: "file", offset: 0 });
      const buf = Buffer.alloc(4);
      buf.writeUInt32BE(h, 0);
      sftp.handle(reqId, buf);
    } catch {
      sftp.status(reqId, SFTP_STATUS_CODE.NO_SUCH_FILE);
    }
  });

  sftp.on("READ", (reqId, handleBuf, offset, length) => {
    const h = handles.get(handleBuf.readUInt32BE(0));
    if (!h) return sftp.status(reqId, SFTP_STATUS_CODE.FAILURE);
    const buf = Buffer.alloc(length);
    const bytesRead = fs.readSync(h.fd, buf, 0, length, offset);
    if (bytesRead === 0) return sftp.status(reqId, SFTP_STATUS_CODE.EOF);
    sftp.data(reqId, buf.slice(0, bytesRead));
  });

  sftp.on("WRITE", (reqId, handleBuf, offset, data) => {
    const h = handles.get(handleBuf.readUInt32BE(0));
    if (!h) return sftp.status(reqId, SFTP_STATUS_CODE.FAILURE);
    fs.writeSync(h.fd, data, 0, data.length, offset);
    sftp.status(reqId, SFTP_STATUS_CODE.OK);
  });

  sftp.on("CLOSE", (reqId, handleBuf) => {
    const h = handles.get(handleBuf.readUInt32BE(0));
    if (h && h.kind === "file") fs.closeSync(h.fd);
    handles.delete(handleBuf.readUInt32BE(0));
    sftp.status(reqId, SFTP_STATUS_CODE.OK);
  });
}
