import Fastify from "fastify";
import fastifyIO from "fastify-socket.io";
import { registerRoutes } from "./server/routes";
import { setupWebSockets } from "./server/websocket";
import { authMiddleware } from "./middleware/auth";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const ENV = process.env.NODE_ENV || "development";
const LOG_LEVEL =
  (process.env.LOG_LEVEL as
    | "trace"
    | "debug"
    | "info"
    | "warn"
    | "error"
    | "fatal") || "info";

async function startServer() {
  console.log(`
╔════════════════════════════════════════╗
║  🛡️  DevShield - Iniciando...          ║
║  Entorno: ${ENV.padEnd(23)}║
║  Puerto: ${String(PORT).padEnd(28)}║
╚════════════════════════════════════════╝
  `);

  try {
    const app = Fastify({
      logger: {
        level: LOG_LEVEL,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      },
    });

    console.log("✓ Fastify inicializado");

    await app.register(fastifyIO, {
      cors: {
        origin: [
          "http://localhost:3000",
          "http://localhost:5173",
          "http://localhost:3001",
        ],
        credentials: true,
      },
    });
    console.log("✓ Socket.io registrado");

    app.addHook("onRequest", authMiddleware);
    console.log("✓ Middleware de autenticación activo");

    await registerRoutes(app);
    console.log("✓ Rutas HTTP registradas");

    const io = await setupWebSockets(app);
    console.log("✓ WebSockets configurados");

    await app.listen({ port: PORT, host: HOST });

    console.log(`
╔════════════════════════════════════════╗
║  ✅  DevShield Online                  ║
║  HTTP:      http://${HOST}:${PORT}          ║
║  WebSocket: ws://${HOST}:${PORT}            ║
║                                        ║
║  Endpoints:                            ║
║  • POST   /api/analyze                 ║
║  • POST   /api/batch-analyze           ║
║  • GET    /api/files/:id/content       ║
║  • GET    /health                      ║
║  • WS     / (Socket.io)                ║
╚════════════════════════════════════════╝
    `);

    const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
    signals.forEach((signal) => {
      process.on(signal, async () => {
        console.log(`\n[${signal}] Cerrando DevShield...`);
        await app.close();
        process.exit(0);
      });
    });
  } catch (err) {
    console.error("❌ Error fatal al iniciar el servidor:", err);
    process.exit(1);
  }
}

startServer().catch((err) => {
  console.error("❌ Error no capturado:", err);
  process.exit(1);
});
