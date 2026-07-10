import type { FastifyInstance } from "fastify";
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
  app.get<{ Reply: HealthResponse }>("/health", async (request, reply) => {
    return reply.send({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
    });
  });

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
