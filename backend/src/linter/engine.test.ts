import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeFile, detectLanguage } from "./engine";

test("detecta el lenguaje por extensión", () => {
  assert.equal(detectLanguage("index.js"), "javascript");
  assert.equal(detectLanguage("main.py"), "python");
  assert.equal(detectLanguage("server.go"), "go");
  assert.equal(detectLanguage("app.ts"), "typescript");
  assert.equal(detectLanguage("README.md"), null);
});

test("JavaScript roto: detecta variable no definida con línea y columna exactas", async () => {
  const source = [
    "function saludar() {",
    "  return 'hola ' + nombre;", // 'nombre' no está definida
    "}",
    "",
  ].join("\n");

  const result = await analyzeFile("index.js", source);
  assert.equal(result.language, "javascript");
  assert.equal(result.failed, undefined);

  const finding = result.findings.find((f) => f.rule === "no-undef");
  assert.ok(finding, "debe reportar no-undef");
  assert.equal(finding!.line, 2);
  assert.equal(finding!.severity, "error");
  assert.match(finding!.message, /nombre/);
  assert.ok(finding!.suggestion);
});

test("JavaScript: no reporta nada sobre código limpio", async () => {
  // sourceType: module trata las declaraciones de nivel superior sin exportar
  // como "no usadas" (correcto para un módulo real), así que el fixture
  // exporta la función, como haría cualquier archivo real de Node.
  const source = "function suma(a, b) {\n  return a + b;\n}\n\nmodule.exports = { suma };\n";
  const result = await analyzeFile("clean.js", source);
  assert.equal(result.findings.length, 0);
});

test("Python roto: flake8 detecta import sin usar y nombre indefinido", async () => {
  const source = ["import os", "", "def check():", "    return valor_no_definido", ""].join("\n");

  const result = await analyzeFile("auth.py", source);
  assert.equal(result.language, "python");
  assert.equal(result.failed, undefined);

  const unusedImport = result.findings.find((f) => f.rule === "F401");
  assert.ok(unusedImport, "debe reportar el import sin usar");
  assert.equal(unusedImport!.line, 1);

  const undefinedName = result.findings.find((f) => f.rule === "F821");
  assert.ok(undefinedName, "debe reportar el nombre indefinido");
});

test("Go: sin staticcheck instalado, el runner falla explícitamente en vez de inventar resultados", async () => {
  const result = await analyzeFile("server.go", "package main\nfunc main() {}\n");
  assert.equal(result.failed, true);
  assert.match(result.error ?? "", /staticcheck/);
});

test("extensión no soportada devuelve failed sin lanzar excepción", async () => {
  const result = await analyzeFile("notas.md", "# hola");
  assert.equal(result.failed, true);
});
