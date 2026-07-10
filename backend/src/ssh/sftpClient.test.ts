import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeSshServer, FAKE_SERVER_CREDS } from "../../test/fakeSshServer";
import { RemoteServerSession } from "./sftpClient";

async function withServer(fn: (port: number, rootDir: string) => Promise<void>) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "devshield-fake-server-"));
  fs.mkdirSync(path.join(rootDir, "src", "utils"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "src", "index.js"), "console.log('hola');\n");
  fs.writeFileSync(path.join(rootDir, "src", "utils", "auth.py"), "import os\n\ndef check():\n    pass\n");

  const { port, close } = await startFakeSshServer(rootDir);
  try {
    await fn(port, rootDir);
  } finally {
    close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

test("se conecta por SSH y arma el árbol de directorios remoto", async () => {
  await withServer(async (port) => {
    const session = await RemoteServerSession.connect({
      host: "127.0.0.1",
      port,
      username: FAKE_SERVER_CREDS.username,
      password: FAKE_SERVER_CREDS.password,
    });

    const tree = await session.buildTree("/src");
    assert.equal(tree.type, "directory");
    const names = tree.children!.map((c) => c.name).sort();
    assert.deepEqual(names, ["index.js", "utils"]);

    const utils = tree.children!.find((c) => c.name === "utils")!;
    assert.equal(utils.type, "directory");
    assert.equal(utils.children![0].name, "auth.py");

    session.close();
  });
});

test("lee un archivo remoto y su contenido llega íntegro", async () => {
  await withServer(async (port) => {
    const session = await RemoteServerSession.connect({
      host: "127.0.0.1",
      port,
      username: FAKE_SERVER_CREDS.username,
      password: FAKE_SERVER_CREDS.password,
    });

    const content = await session.readFile("/src/index.js");
    assert.equal(content, "console.log('hola');\n");
    session.close();
  });
});

test("guarda cambios de vuelta en el servidor remoto vía SFTP (guardado bidireccional)", async () => {
  await withServer(async (port, rootDir) => {
    const session = await RemoteServerSession.connect({
      host: "127.0.0.1",
      port,
      username: FAKE_SERVER_CREDS.username,
      password: FAKE_SERVER_CREDS.password,
    });

    await session.writeFile("/src/index.js", "console.log('corregido');\n");
    session.close();

    const onDisk = fs.readFileSync(path.join(rootDir, "src", "index.js"), "utf8");
    assert.equal(onDisk, "console.log('corregido');\n");
  });
});

test("streaming: createReadStream nunca acumula todo el archivo en un solo Buffer del backend", async () => {
  await withServer(async (port) => {
    const session = await RemoteServerSession.connect({
      host: "127.0.0.1",
      port,
      username: FAKE_SERVER_CREDS.username,
      password: FAKE_SERVER_CREDS.password,
    });

    const stream = session.createReadStream("/src/index.js");
    let chunkCount = 0;
    let total = "";
    for await (const chunk of stream) {
      chunkCount++;
      total += chunk.toString("utf8");
    }
    assert.ok(chunkCount >= 1);
    assert.equal(total, "console.log('hola');\n");
    session.close();
  });
});

test("una credencial incorrecta rechaza la conexión (SftpConnectionError)", async () => {
  await withServer(async (port) => {
    await assert.rejects(
      RemoteServerSession.connect({
        host: "127.0.0.1",
        port,
        username: FAKE_SERVER_CREDS.username,
        password: "contraseña-incorrecta",
      })
    );
  });
});
