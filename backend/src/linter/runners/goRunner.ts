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
    throw new Error(
      "staticcheck no está instalado. Instala con: go install honnef.co/go/tools/cmd/staticcheck@latest"
    );
  }

  const dir = mkdtempSync(path.join(tmpdir(), "devshield-go-"));
  const filePath = path.join(dir, path.basename(filename));
  writeFileSync(filePath, source, "utf8");

  try {
    const findings: Finding[] = [];
    const child = spawn("staticcheck", [filePath]);
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));

    await new Promise((resolve) => child.on("close", resolve));

    for (const line of stdout.trim().split("\n")) {
      if (!line) continue;
      const match = line.match(/(\d+):(\d+): ([A-Z]+): (.+)/);
      if (match) {
        findings.push({
          line: parseInt(match[1], 10),
          column: parseInt(match[2], 10),
          severity: match[3] === "error" ? "error" : "warning",
          rule: match[3],
          message: match[4],
          tool: "staticcheck",
        });
      }
    }

    return findings;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
