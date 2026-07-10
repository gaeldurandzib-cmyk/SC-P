import type { FastifyInstance } from "fastify";
import { Server as SocketIOServer, Socket } from "socket.io";
import { analyzeFile } from "../linter/engine";
import type { Finding, AnalysisResult } from "../linter/engine";

interface AnalyzeStartPayload {
  fileId: string;
  filename: string;
  source: string;
  language?: string;
}

interface FindingEvent {
  fileId: string;
  finding: Finding;
  timestamp: string;
}

interface AnalyzeCompletePayload {
  fileId: string;
  findings: Finding[];
  duration: number;
  timestamp: string;
}

interface AnalyzeErrorPayload {
  fileId: string;
  error: string;
  timestamp: string;
}

export async function setupWebSockets(
  app: FastifyInstance
): Promise<SocketIOServer> {
  const io = new SocketIOServer(app.server, {
    cors: {
      origin: ["http://localhost:3000", "http://localhost:5173"],
      credentials: true,
    },
  });

  io.on("connection", (socket: Socket) => {
    const clientId = socket.id;
    console.log(`[WS] Cliente conectado: ${clientId}`);

    socket.on(
      "analyze:start",
      async (payload: AnalyzeStartPayload) => {
        const { fileId, filename, source, language } = payload;

        if (!fileId || !filename || !source) {
          socket.emit("analyze:error", {
            fileId,
            error: "Missing fileId, filename, or source",
            timestamp: new Date().toISOString(),
          } as AnalyzeErrorPayload);
          return;
        }

        const roomId = `file:${fileId}`;
        socket.join(roomId);
        console.log(
          `[WS] ${clientId} se unió a sala ${roomId} (${filename})`
        );

        const startTime = Date.now();

        try {
          const result: AnalysisResult = await analyzeFile(
            filename,
            source
          );

          for (const finding of result.findings) {
            io.to(roomId).emit("finding", {
              fileId,
              finding,
              timestamp: new Date().toISOString(),
            } as FindingEvent);
          }

          const duration = Date.now() - startTime;
          io.to(roomId).emit("analyze:complete", {
            fileId,
            findings: result.findings,
            duration,
            timestamp: new Date().toISOString(),
          } as AnalyzeCompletePayload);

          console.log(
            `[WS] Análisis completado para ${roomId} (${result.findings.length} hallazgos, ${duration}ms)`
          );
        } catch (err: any) {
          const error =
            err instanceof Error ? err.message : String(err);
          io.to(roomId).emit("analyze:error", {
            fileId,
            error,
            timestamp: new Date().toISOString(),
          } as AnalyzeErrorPayload);

          console.error(
            `[WS] Error en análisis de ${roomId}:`,
            error
          );
        }
      }
    );

    socket.on(
      "analyze:batch",
      async (
        payload: {
          batchId: string;
          files: Array<{
            fileId: string;
            filename: string;
            source: string;
          }>;
        }
      ) => {
        const { batchId, files } = payload;

        if (!batchId || !files || files.length === 0) {
          socket.emit("batch:error", {
            batchId,
            error: "Missing batchId or empty files array",
          });
          return;
        }

        const roomId = `batch:${batchId}`;
        socket.join(roomId);

        const startTime = Date.now();
        const results: Record<string, AnalysisResult> = {};

        try {
          const analysisPromises = files.map((file) =>
            analyzeFile(file.filename, file.source).then((result) => ({
              fileId: file.fileId,
              result,
            }))
          );

          const analyses = await Promise.all(analysisPromises);

          for (const { fileId, result } of analyses) {
            results[fileId] = result;

            io.to(roomId).emit("batch:file-complete", {
              batchId,
              fileId,
              findings: result.findings,
              failed: result.failed,
            });
          }

          const duration = Date.now() - startTime;
          const totalFindings = Object.values(results).reduce(
            (sum, r) => sum + r.findings.length,
            0
          );

          io.to(roomId).emit("batch:complete", {
            batchId,
            filesAnalyzed: files.length,
            totalFindings,
            results,
            duration,
            timestamp: new Date().toISOString(),
          });

          console.log(
            `[WS] Análisis en lote completado para ${roomId} (${files.length} archivos, ${totalFindings} hallazgos, ${duration}ms)`
          );
        } catch (err: any) {
          const error =
            err instanceof Error ? err.message : String(err);

          io.to(roomId).emit("batch:error", {
            batchId,
            error,
            timestamp: new Date().toISOString(),
          });

          console.error(`[WS] Error en lote ${roomId}:`, error);
        }
      }
    );

    socket.on("disconnect", () => {
      console.log(`[WS] Cliente desconectado: ${clientId}`);
    });

    socket.emit("connected", {
      clientId,
      timestamp: new Date().toISOString(),
    });
  });

  console.log("[WS] Servidor WebSocket configurado");
  return io;
}
