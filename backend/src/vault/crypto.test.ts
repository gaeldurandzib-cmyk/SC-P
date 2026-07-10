import assert from "node:assert/strict";
import { test } from "node:test";
import { KeyRing, encryptSecret, decryptSecret, MasterKeyNotFoundError, safeEqual } from "./crypto";

const KEY_A = KeyRing.generateKeyBase64();
const KEY_B = KeyRing.generateKeyBase64();

test("cifra y descifra una llave privada SSH de ida y vuelta", () => {
  const ring = new KeyRing("k1", KEY_A);
  const privateKey = "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAB3NzaC1yc2EAAAADAQABAAAB...\n-----END OPENSSH PRIVATE KEY-----";

  const blob = encryptSecret(privateKey, ring);
  assert.notEqual(blob.ciphertext, privateKey, "el texto cifrado nunca debe verse igual al original");

  const recovered = decryptSecret(blob, ring);
  assert.equal(recovered, privateKey);
});

test("dos cifrados del mismo secreto producen ciphertext distinto (IV aleatorio)", () => {
  const ring = new KeyRing("k1", KEY_A);
  const blob1 = encryptSecret("hunter2", ring);
  const blob2 = encryptSecret("hunter2", ring);
  assert.notEqual(blob1.ciphertext, blob2.ciphertext);
  assert.notEqual(blob1.iv, blob2.iv);
});

test("REQUISITO CRÍTICO: robar la base de datos no alcanza para leer las credenciales", () => {
  // Simula lo que un atacante vería si roba solo la tabla de PostgreSQL:
  // guarda el blob cifrado tal cual quedaría en la BD, sin la llave maestra
  // (esa vive en las variables de entorno del backend, no en la BD).
  const ring = new KeyRing("k1", KEY_A);
  const blob = encryptSecret("password-del-servidor-del-cliente", ring);

  const rowStoredInDatabase = JSON.parse(JSON.stringify(blob)); // solo lo que persiste en disco

  // El atacante NO tiene el keyring (no tiene el proceso backend ni su .env).
  const attackerRing = new KeyRing("otra-llave-que-no-es-la-correcta", KeyRing.generateKeyBase64());

  assert.throws(
    () => decryptSecret(rowStoredInDatabase, attackerRing),
    MasterKeyNotFoundError,
    "sin la llave maestra correcta, el secreto debe ser irrecuperable"
  );
});

test("si el ciphertext fue alterado, GCM detecta la manipulación y falla", () => {
  const ring = new KeyRing("k1", KEY_A);
  const blob = encryptSecret("password-del-servidor-del-cliente", ring);

  const tampered = { ...blob, ciphertext: Buffer.from("dato-alterado-por-atacante").toString("base64") };

  assert.throws(() => decryptSecret(tampered, ring));
});

test("rotación de llave maestra: datos viejos se siguen leyendo, datos nuevos usan la llave nueva", () => {
  const ring = new KeyRing("k1", KEY_A);
  const oldBlob = encryptSecret("secreto-cifrado-con-k1", ring);

  ring.addKey("k2", KEY_B);
  ring.rotateTo("k2");
  const newBlob = encryptSecret("secreto-cifrado-con-k2", ring);

  assert.equal(oldBlob.keyId, "k1");
  assert.equal(newBlob.keyId, "k2");
  // Ambos se pueden descifrar mientras k1 siga en el keyring.
  assert.equal(decryptSecret(oldBlob, ring), "secreto-cifrado-con-k1");
  assert.equal(decryptSecret(newBlob, ring), "secreto-cifrado-con-k2");
});

test("una llave maestra corrupta (longitud incorrecta) se rechaza al cargarla, no al usarla", () => {
  assert.throws(() => new KeyRing("bad", Buffer.from("demasiado-corta").toString("base64")));
});

test("safeEqual compara en tiempo constante y no confunde strings de distinto largo", () => {
  assert.equal(safeEqual("token-123", "token-123"), true);
  assert.equal(safeEqual("token-123", "token-124"), false);
  assert.equal(safeEqual("corto", "mucho-mas-largo"), false);
});
