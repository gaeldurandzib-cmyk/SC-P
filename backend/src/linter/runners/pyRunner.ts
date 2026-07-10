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

export async function runPythonLinters(filename: string, source: string): Promise<Finding[]> {
  if (!(await commandExists("flake8"))) {
    throw new Error(
      "flake8 no está instalado. Instala con: pip install flake8 mypy"
    );
  }

  const dir = mkdtempSync(path.join(tmpdir(), "devshield-py-"));
  const filePath = path.join(dir, path.basename(filename));
  writeFileSync(filePath, source, "utf8");

  try {
    const findings: Finding[] = [];

    const flake8 = spawn("flake8", [filePath]);
    let flake8Output = "";
    flake8.stdout.on("data", (d) => (flake8Output += d.toString()));

    await new Promise((resolve) => flake8.on("close", resolve));

    for (const line of flake8Output.trim().split("\n")) {
      if (!line) continue;
      const match = line.match(/(\d+):(\d+): (\w+) (.+)/);
      if (match) {
        findings.push({
          line: parseInt(match[1], 10),
          column: parseInt(match[2], 10),
          severity: match[3].startsWith("E") ? "error" : "warning",
          rule: match[3],
          message: match[4],
          tool: "flake8",
        });
      }
    }

    return findings;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
