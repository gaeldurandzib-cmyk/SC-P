/**
 * runners/pyRunner.ts — analiza Python con flake8 (estilo + errores obvios,
 * vía pyflakes) y mypy (tipos). Corren como procesos separados sobre un
 * archivo temporal en un tmpfs efímero — en producción ese tmpfs vive DENTRO
 * del contenedor Docker aislado (--tmpfs /tmp, --network none), nunca en
 * disco persistente del backend principal.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Finding } from "../engine";

function run(cmd: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args);
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", () => {}); // flake8/mypy meten ruido de progreso en stderr; se ignora
    child.on("close", (code) => resolve({ stdout, code: code ?? 0 }));
    child.on("error", () => resolve({ stdout: "", code: -1 }));
  });
}

export async function runPythonLinters(filename: string, source: string): Promise<Finding[]> {
  const dir = mkdtempSync(path.join(tmpdir(), "devshield-py-"));
  const filePath = path.join(dir, path.basename(filename));
  writeFileSync(filePath, source, "utf8");

  try {
    const [flake8Findings, mypyFindings] = await Promise.all([
      runFlake8(filePath, filename),
      runMypy(filePath, filename),
    ]);
    return [...flake8Findings, ...mypyFindings];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runFlake8(filePath: string, displayName: string): Promise<Finding[]> {
  // Formato: ruta:línea:columna: CÓDIGO mensaje
  const { stdout } = await run("flake8", ["--format=%(row)d:%(col)d:%(code)s:%(text)s", filePath]);
  if (!stdout.trim()) return [];

  return stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [lineNo, col, code, ...rest] = line.split(":");
      const message = rest.join(":").trim();
      return {
        line: Number(lineNo),
        column: Number(col),
        severity: (code.startsWith("E9") || code.startsWith("F82") ? "error" : "warning") as Finding["severity"],
        rule: code,
        message: translateFlake8(code, message),
        suggestion: suggestionForFlake8(code),
        tool: "flake8",
      };
    })
    .filter((f) => !Number.isNaN(f.line));
}

async function runMypy(filePath: string, displayName: string): Promise<Finding[]> {
  const { stdout } = await run("python3", ["-m", "mypy", "--no-color-output", "--no-error-summary", filePath]);
  if (!stdout.trim()) return [];

  // Formato: ruta:línea: error: mensaje  [código-de-regla]
  const re = /^(.*?):(\d+):(?:(\d+):)?\s*(error|note):\s*(.*?)(?:\s*\[(.+)\])?$/;
  return stdout
    .trim()
    .split("\n")
    .map((line) => re.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      line: Number(m[2]),
      column: m[3] ? Number(m[3]) : 1,
      severity: (m[4] === "error" ? "error" : "warning") as Finding["severity"],
      rule: m[6] ?? "mypy",
      message: m[5],
      tool: "mypy",
    }));
}

function translateFlake8(code: string, message: string): string {
  if (code === "F401") {
    const match = message.match(/'(.+)' imported but unused/);
    return match ? `import '${match[1]}' sin usar.` : message;
  }
  if (code === "F821") {
    const match = message.match(/undefined name '(.+)'/);
    return match ? `'${match[1]}' no está definida.` : message;
  }
  return message;
}

function suggestionForFlake8(code: string): string | undefined {
  if (code === "F401") return "Elimina el import si no se usa en el archivo.";
  if (code === "F821") return "Define la variable antes de usarla o corrige el nombre.";
  if (code === "E302") return "Deja dos líneas en blanco antes de la definición de la función.";
  return undefined;
}
