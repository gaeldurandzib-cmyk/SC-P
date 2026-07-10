/**
 * runners/jsRunner.ts — analiza JS/TS con ESLint y traduce su salida al
 * formato común `Finding`. En producción esto corre dentro del contenedor
 * `devshield/eslint-runner` (ver dockerCommandFor en engine.ts); aquí invoca
 * la API programática de ESLint directamente sobre texto en memoria — nunca
 * escribe el código del usuario en disco del backend principal.
 */
import { ESLint } from "eslint";
import type { Finding } from "../engine";

// Config mínima y deliberadamente estricta en detección de errores reales
// (variables no definidas, etc.), pensada para código de terceros, no para
// el estilo de un proyecto propio.
const RULES = {
  "no-undef": "error",
  "no-unused-vars": "warn",
  "no-unreachable": "error",
  eqeqeq: "warn",
} as const;

export async function runEslint(filename: string, source: string): Promise<Finding[]> {
  const eslint = new ESLint({
    useEslintrc: false,
    overrideConfig: {
      env: { node: true, es2021: true, browser: true },
      parserOptions: { ecmaVersion: 2021, sourceType: "module" },
      rules: RULES,
    },
  });

  const [result] = await eslint.lintText(source, { filePath: filename });

  return result.messages.map((m) => ({
    line: m.line,
    column: m.column,
    severity: m.severity === 2 ? "error" : "warning",
    rule: m.ruleId ?? "syntax-error",
    message: translateMessage(m.message, m.ruleId),
    suggestion: suggestionFor(m.ruleId, m.message),
    tool: "eslint",
  }));
}

/** Traducciones cortas al español para los mensajes más comunes de ESLint. */
function translateMessage(message: string, ruleId: string | null): string {
  const undefMatch = message.match(/'(.+)' is not defined/);
  if (undefMatch) return `'${undefMatch[1]}' no está definida en este contexto.`;

  const unusedMatch = message.match(/'(.+)' is (defined|assigned a value) but never used/);
  if (unusedMatch) return `'${unusedMatch[1]}' se declara pero nunca se usa.`;

  if (ruleId === "eqeqeq") return "Usa '===' en vez de '==' para evitar comparaciones con conversión de tipo implícita.";

  return message;
}

function suggestionFor(ruleId: string | null, message: string): string | undefined {
  const undefMatch = message.match(/'(.+)' is not defined/);
  if (undefMatch) return `Declarar la variable, por ejemplo: const ${undefMatch[1]} = ...;`;
  if (ruleId === "eqeqeq") return "Reemplazar '==' por '===' (o '!=' por '!==').";
  if (ruleId === "no-unused-vars") return "Eliminar la variable o el import si ya no se usa.";
  return undefined;
}
