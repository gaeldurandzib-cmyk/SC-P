/**
 * vault/crypto.ts
 *
 * Cifra y descifra credenciales SSH (contraseñas o llaves privadas) antes de
 * guardarlas en PostgreSQL. Si alguien roba la base de datos, estos valores
 * deben ser ilegibles sin la llave maestra, que vive SOLO en las variables
 * de entorno del backend (nunca en la base de datos).
 *
 * Algoritmo: AES-256-GCM
 *   - 256 bits de llave  -> resistente a fuerza bruta.
 *   - GCM es un modo "autenticado": además de cifrar, genera un tag que
 *     detecta si el texto cifrado fue modificado (integridad + confidencialidad).
 *   - Cada cifrado usa un IV (vector de inicialización) aleatorio de 12 bytes,
 *     nunca reutilizado, para que cifrar el mismo texto dos veces dé resultados
 *     distintos.
 *
 * Rotación de llave maestra:
 *   - Las llaves maestras viven en un "keyring": un mapa { keyId -> llave }.
 *   - Cada blob cifrado guarda el keyId que se usó, no la llave en sí.
 *   - Para rotar: se agrega una llave nueva con un keyId nuevo, se marca como
 *     "activa" para cifrar datos nuevos, y las llaves viejas se conservan
 *     solo para poder descifrar datos antiguos hasta que se re-cifren.
 */

import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recomendado para GCM
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

export interface EncryptedBlob {
  /** Identificador de la llave maestra usada (para soportar rotación). */
  keyId: string;
  /** IV en base64. */
  iv: string;
  /** Texto cifrado en base64. */
  ciphertext: string;
  /** Tag de autenticación GCM en base64. */
  authTag: string;
}

export class MasterKeyNotFoundError extends Error {
  constructor(keyId: string) {
    super(`No existe una llave maestra registrada con keyId "${keyId}". El dato es irrecuperable sin ella.`);
    this.name = "MasterKeyNotFoundError";
  }
}

/**
 * Mantiene el conjunto de llaves maestras disponibles (para rotación) y cuál
 * de ellas se usa para cifrar datos nuevos. Las llaves NUNCA se derivan de
 * nada guardado en la base de datos: se cargan desde el entorno del proceso.
 */
export class KeyRing {
  private keys = new Map<string, Buffer>();
  private activeKeyId: string;

  constructor(initialKeyId: string, initialKeyBase64: string) {
    this.addKey(initialKeyId, initialKeyBase64);
    this.activeKeyId = initialKeyId;
  }

  /** Carga el keyring completo desde variables de entorno tipo VAULT_KEY_<id>=<base64>. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): KeyRing {
    const activeKeyId = env.VAULT_ACTIVE_KEY_ID;
    if (!activeKeyId) {
      throw new Error("VAULT_ACTIVE_KEY_ID no está definida en el entorno.");
    }
    const activeVar = `VAULT_KEY_${activeKeyId}`;
    const activeKey = env[activeVar];
    if (!activeKey) {
      throw new Error(`${activeVar} no está definida en el entorno.`);
    }

    const ring = new KeyRing(activeKeyId, activeKey);

    // Carga llaves antiguas (para descifrar datos existentes tras rotar).
    for (const [name, value] of Object.entries(env)) {
      const match = name.match(/^VAULT_KEY_(.+)$/);
      if (match && match[1] !== activeKeyId && value) {
        ring.addKey(match[1], value);
      }
    }
    return ring;
  }

  addKey(keyId: string, keyBase64: string): void {
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== KEY_LENGTH) {
      throw new Error(`La llave maestra "${keyId}" debe tener ${KEY_LENGTH} bytes (256 bits) en base64; tiene ${key.length}.`);
    }
    this.keys.set(keyId, key);
  }

  /** Marca una llave ya cargada como la activa para cifrar datos nuevos (rotación). */
  rotateTo(keyId: string): void {
    if (!this.keys.has(keyId)) {
      throw new MasterKeyNotFoundError(keyId);
    }
    this.activeKeyId = keyId;
  }

  getActive(): { keyId: string; key: Buffer } {
    return { keyId: this.activeKeyId, key: this.keys.get(this.activeKeyId)! };
  }

  get(keyId: string): Buffer {
    const key = this.keys.get(keyId);
    if (!key) throw new MasterKeyNotFoundError(keyId);
    return key;
  }

  /** Genera una llave nueva aleatoria de 256 bits, lista para poner en el entorno. */
  static generateKeyBase64(): string {
    return randomBytes(KEY_LENGTH).toString("base64");
  }
}

/** Cifra texto plano (contraseña o llave privada SSH) con la llave activa del keyring. */
export function encryptSecret(plaintext: string, ring: KeyRing): EncryptedBlob {
  const { keyId, key } = ring.getActive();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    keyId,
    iv: iv.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/**
 * Descifra un blob. Si la llave maestra correcta no está en el keyring
 * (por ejemplo, un atacante que solo tiene la base de datos, no el entorno
 * del backend), esto lanza MasterKeyNotFoundError: el secreto es irrecuperable.
 * Si el texto cifrado fue alterado, GCM lanza un error de autenticación.
 */
export function decryptSecret(blob: EncryptedBlob, ring: KeyRing): string {
  const key = ring.get(blob.keyId); // lanza MasterKeyNotFoundError si no existe

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(blob.iv, "base64"), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(blob.authTag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "base64")),
    decipher.final(), // lanza si el authTag no coincide (dato alterado o llave incorrecta)
  ]);

  return decrypted.toString("utf8");
}

/** Compara dos secretos en tiempo constante (evita ataques de timing al comparar tokens). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
