import { runEslint } from "./runners/jsRunner";
import { runPythonLinters } from "./runners/pyRunner";
import { runStaticcheck } from "./runners/goRunner";
import { runPHPLint } from "./runners/phpRunner";

export type Severity = "error" | "warning";

export interface Finding {
  line: number;
  column: number;
  severity: Severity;
  rule: string;
  message: string;
  suggestion?: string;
  tool: string;
}

export interface AnalysisResult {
  file: string;
  language: SupportedLanguage;
  findings: Finding[];
  failed?: boolean;
  error?: string;
}

export type SupportedLanguage = "javascript" | "typescript" | "python" | "go" | "php";

const EXTENSION_MAP: Record<string, SupportedLanguage> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".py": "python",
  ".go": "go",
  ".php": "php",
};

export function detectLanguage(filename: string): SupportedLanguage | null {
  const ext = filename.slice(filename.lastIndexOf("."));
  return EXTENSION_MAP[ext] ?? null;
}

export async function analyzeFile(filename: string, source: string): Promise<AnalysisResult> {
  const language = detectLanguage(filename);
  if (!language) {
    return { file: filename, language: "javascript", findings: [], failed: true, error: "Extensión no soportada." };
  }

  try {
    let findings: Finding[];
    switch (language) {
      case "javascript":
      case "typescript":
        findings = await runEslint(filename, source);
        break;
      case "python":
        findings = await runPythonLinters(filename, source);
        break;
      case "go":
        findings = await runStaticcheck(filename, source);
        break;
      case "php":
        findings = await runPHPLint(filename, source);
        break;
    }
    return { file: filename, language, findings };
  } catch (err) {
    return { file: filename, language, findings: [], failed: true, error: err instanceof Error ? err.message : String(err) };
  }
}

export function dockerCommandFor(language: SupportedLanguage): string[] {
  const image: Record<SupportedLanguage, string> = {
    javascript: "devshield/eslint-runner:latest",
    typescript: "devshield/eslint-runner:latest",
    python: "devshield/flake8-mypy-runner:latest",
    go: "devshield/staticcheck-runner:latest",
    php: "devshield/phpcs-runner:latest",
  };
  return [
    "docker", "run",
    "--rm",
    "--network", "none",
    "--memory", "256m",
    "--cpus", "0.5",
    "--read-only",
    "--tmpfs", "/tmp:size=16m",
    "-i", image[language],
  ];
}
