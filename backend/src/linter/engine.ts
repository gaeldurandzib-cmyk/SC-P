/**
 * linter/engine.ts
 *
 * Punto de entrada del "motor de análisis" del microservicio aislado.
 * Recibe código fuente + nombre de archivo, detecta el lenguaje por
 * extensión, y lo despacha al runner correspondiente. Cada runner devuelve
 * una lista de `Finding` con el MISMO formato sin importar el lenguaje, para
 * que el frontend (Monaco Editor) pueda pintar todas las líneas rojas/amarillas
 * de la misma manera.
 *
 * Aislamiento: en producción, cada runner no ejecuta el código del usuario en
 * este proceso. Lanza un contenedor Docker desechable (imagen mínima, sin red,
 * con límite de CPU/memoria y timeout) y le pasa el código por stdin o por un
 * volumen efímero de solo lectura. Aquí se implementa la interfaz de runner y
 * el parseo de resultados; `runInSandbox()` documenta el comando Docker real.
 */

import { runEslint } from "./runners/jsRunner";
import { runPythonLinters } from "./runners/pyRunner";
import { runStaticcheck } from "./runners/goRunner";
import { runPHPLint } from "./runners/phpRunner";

export type Severity = "error" | "warning";

export interface Finding {
  line: number;
  column: number;
  severity: Severity;
  /** Código de regla de la herramienta subyacente, p.ej. "no-undef", "F401". */
  rule: string;
  message: string;
  /** Sugerencia de corrección automatizada, si la herramienta la provee. */
  suggestion?: string;
  tool: string;
}

export interface AnalysisResult {
  file: string;
  language: SupportedLanguage;
  findings: Finding[];
  /** true si el análisis no pudo completarse (timeout, sandbox caído, etc). */
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

/**
 * Analiza un archivo. No lanza excepción si el linter subyacente falla:
 * en su lugar devuelve `failed: true`, porque un error de análisis no debe
 * tumbar la petición del usuario (sigue pudiendo editar y guardar).
 */
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

/**
 * Documenta cómo se invocaría cada runner AISLADO en producción, dentro de
 * un contenedor Docker desechable, sin red y con límites de recursos.
 * Los runners de este proyecto de ejemplo ejecutan el binario directamente
 * en el sandbox de desarrollo (sin Docker disponible aquí), pero exponen la
 * misma interfaz para que cambiar a `runInSandbox` sea un solo punto de cambio.
 */
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
    "--network", "none", // el linter jamás necesita salir a internet
    "--memory", "256m",
    "--cpus", "0.5",
    "--read-only",
    "--tmpfs", "/tmp:size=16m",
    "-i", image[language],
  ];
}
