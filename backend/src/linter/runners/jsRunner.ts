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

export async function runEslint(filename: string, source: string): Promise<Finding[]> {
  if (!(await commandExists("eslint"))) {
    throw new Error(
      "ESLint no está instalado. Instala con: npm install -g eslint"
    );
  }

  const dir = mkdtempSync(path.join(tmpdir(), "devshield-js-"));
  const filePath = path.join(dir, path.basename(filename));
  writeFileSync(filePath, source, "utf8");

  try {
    const findings: Finding[] = [];
    const child = spawn("eslint", [filePath, "--format", "json"], {
      timeout: 10000,
    });

    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));

    await new Promise((resolve) => child.on("close", resolve));

    if (stdout.trim()) {
      try {
        const results = JSON.parse(stdout);
        if (results[0]?.messages) {
          for (const msg of results[0].messages) {
            findings.push({
              line: msg.line || 1,
              column: msg.column || 1,
              severity: msg.severity === 2 ? "error" : "warning",
              rule: msg.ruleId || "unknown",
              message: msg.message,
              tool: "eslint",
            });
          }
        }
      } catch {
        // JSON parse error, ignore
      }
    }

    return findings;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
