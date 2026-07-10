/**
 * runners/goRunner.ts — analiza Go con `staticcheck`.
 *
 * Este runner requiere el toolchain de Go instalado (o, en producción, el
 * contenedor `devshield/staticcheck-runner` que ya lo trae). En este entorno
 * de desarrollo Go no está disponible, así que la función detecta esa
 * ausencia explícitamente y devuelve `failed` en vez de fingir un resultado.
 * La forma de invocar el binario real queda documentada aquí para cuando el
 * runner se despliegue en su contenedor.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Finding } from "../engine";

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, ["version"]);
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function runStaticcheck(filename: string, source: string): Promise<Finding[]> {
  if (!(await commandExists("staticcheck"))) {
    // Señal explícita de "no disponible en este entorno", no un resultado inventado.
    throw new Error(
      "staticcheck no está instalado en este entorno de desarrollo. " +
        "En producción este runner corre dentro del contenedor devshield/staticcheck-runner."
    );
  }

  const dir = mkdtempSync(path.join(tmpdir(), "devshield-go-"));
  const filePath = path.join(dir, path.basename(filename));
  writeFileSync(filePath, source, "utf8");

  try {
    const findings: Finding[] = [];
    const child = spawn("staticcheck", ["-f", "json", filePath]);
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    await new Promise((resolve) => child.on("close", resolve));

    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      const parsed = JSON.parse(line);
      findings.push({
        line: parsed.location.line,
        column: parsed.location.column,
        severity: "warning",
        rule: parsed.code,
        message: parsed.message,
        tool: "staticcheck",
      });
    }
    return findings;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
