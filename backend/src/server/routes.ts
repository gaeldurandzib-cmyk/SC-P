/**
 * server/routes.ts
 *
 * Rutas HTTP del microservicio DevShield. Implementa:
 * - GET /api/files/:sessionId/content → Lee archivo remoto vía SFTP con streaming
 * - POST /api/analyze → Analiza código fuente y devuelve hallazgos
 * - GET /health → Verificar estado del servicio
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { analyzeFile } from "../linter/engine";

interface FileContentQuery {
  path: string;
}

interface AnalyzeBody {
  filename: string;
  source: string;
  language?: string;
}

interface HealthResponse {
  status: "ok";
  timestamp: string;
  version: string;
}

export async function registerRoutes(app: FastifyInstance) {
  /**
   * GET /health
   * Endpoint de verificación de salud del servicio.
   */
  app.get<{ Reply: HealthResponse }>("/health", async (request, reply) => {
    return reply.send({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
    });
  });

  /**
   * POST /api/analyze
   * Recibe código fuente, lo analiza con el linter correspondiente,
   * y devuelve hallazgos (errores, warnings, sugerencias).
   *
   * Body:
   * {
   *   "filename": "app.ts",
   *   "source": "const x: number = 'hello';",
   *   "language": "typescript" (optional, detectado por extensión si se omite)
   * }
   *
   * Response:
   * {
   *   "file": "app.ts",
   *   "language": "typescript",
   *   "findings": [
   *     {
   *       "line": 1,
   *       "column": 27,
   *       "severity": "error",
   *       "rule": "no-undef",
   *       "message": "...",
   *       "tool": "eslint"
   *     }
   *   ],
   *   "failed": false
   * }
   */
  app.post<{ Body: AnalyzeBody }>("/api/analyze", async (request, reply) => {
    const { filename, source } = request.body;

    if (!filename || !source) {
      return reply.status(400).send({
        error: "Missing required fields: filename, source",
      });
    }

    try {
      const result = await analyzeFile(filename, source);
      return reply.status(result.failed ? 400 : 200).send(result);
    } catch (err: any) {
      return reply.status(500).send({
        error: err.message || "Analysis failed",
      });
    }
  });

  /**
   * GET /api/files/:sessionId/content
   * Lee un archivo remoto mediante SFTP con streaming de bajo consumo de memoria.
   * En producción, esta ruta necesitaría:
   * 1. Validar que el usuario está autenticado
   * 2. Verificar que el sessionId existe y pertenece al usuario
   * 3. Conectar el SFTP stream a la respuesta HTTP
   *
   * Por ahora es un placeholder para documentar la interfaz.
   *
   * Query params:
   * - path: ruta del archivo remoto (ej: "/home/user/project/main.ts")
   *
   * Response: el contenido del archivo con tipo MIME detectado
   */
  app.get<{ Params: { sessionId: string }; Querystring: FileContentQuery }>(
    "/api/files/:sessionId/content",
    async (request, reply) => {
      const { sessionId } = request.params;
      const { path: filePath } = request.query;

      if (!sessionId || !filePath) {
        return reply.status(400).send({
          error: "Missing sessionId or path",
        });
      }

      try {
        // TODO: Implementar conexión real a SFTP
        // const stream = await sftpClient.createReadStream(filePath);
        // reply.type("text/plain");
        // return reply.send(stream);

        // Por ahora retorna un placeholder
        return reply.status(501).send({
          error: "SFTP streaming not yet implemented in this deployment",
          sessionId,
          path: filePath,
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: err.message,
        });
      }
    }
  );

  /**
   * POST /api/batch-analyze
   * Analiza múltiples archivos en paralelo.
   * Útil para repositorios completos.
   *
   * Body:
   * {
   *   "files": [
   *     { "filename": "a.ts", "source": "..." },
   *     { "filename": "b.py", "source": "..." }
   *   ]
   * }
   */
  app.post<{ Body: { files: AnalyzeBody[] } }>(
    "/api/batch-analyze",
    async (request, reply) => {
      const { files } = request.body;

      if (!files || !Array.isArray(files)) {
        return reply.status(400).send({
          error: "files must be an array",
        });
      }

      if (files.length === 0) {
        return reply.status(400).send({
          error: "files array cannot be empty",
        });
      }

      try {
        const results = await Promise.all(
          files.map((file) => analyzeFile(file.filename, file.source))
        );

        return reply.send({
          count: results.length,
          results,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: err.message || "Batch analysis failed",
        });
      }
    }
  );
}
