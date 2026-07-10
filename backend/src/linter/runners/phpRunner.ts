import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Finding } from "../engine";

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, ["--version"]);
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function runPHPLint(filename: string, source: string): Promise<Finding[]> {
  if (!(await commandExists("php"))) {
    throw new Error(
      "PHP no está instalado en este entorno de desarrollo. " +
        "En producción este runner corre dentro del contenedor devshield/phpcs-runner."
    );
  }

  const dir = mkdtempSync(path.join(tmpdir(), "devshield-php-"));
  const filePath = path.join(dir, path.basename(filename));
  writeFileSync(filePath, source, "utf8");

  try {
    const findings: Finding[] = [];
    const child = spawn("php", ["-l", filePath]);
    let stderr = "";
    let stdout = "";
    
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", (d) => (stdout += d.toString()));
    
    await new Promise((resolve) => child.on("close", resolve));

    const output = stderr || stdout;
    
    if (output.includes("Parse error") || output.includes("Fatal error")) {
      const lineMatch = output.match(/line (\d+)/);
      const line = lineMatch ? parseInt(lineMatch[1], 10) : 1;
      
      const messageMatch = output.match(/Parse error: (.+?) in/);
      const message = messageMatch ? messageMatch[1] : output.split("\n")[0];
      
      findings.push({
        line,
        column: 1,
        severity: "error",
        rule: "syntax_error",
        message: translatePHPError(message),
        tool: "php",
      });
    }
    
    return findings;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function translatePHPError(message: string): string {
  if (message.includes("syntax error")) {
    return "Error de sintaxis en PHP.";
  }
  if (message.includes("unexpected")) {
    const match = message.match(/unexpected '(.+?)'/);
    return match ? `Token inesperado: '${match[1]}'` : "Token inesperado.";
  }
  if (message.includes("expecting")) {
    const match = message.match(/expecting '(.+?)'/);
    return match ? `Se esperaba: '${match[1]}'` : "Síntaxis incompleta.";
  }
  return message;
}
