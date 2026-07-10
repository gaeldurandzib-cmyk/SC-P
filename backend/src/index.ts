/**
 * index.ts
 *
 * 🛡️ DevShield - Orquestador Central
 *
 * Punto de entrada del microservicio. Ensambla todos los componentes:
 * 1. KeyRing: Inicializa la criptografía maestra
 * 2. Fastify: Crea instancia del servidor HTTP
 * 3. Socket.io: Configura WebSockets para feedback en tiempo real
 * 4. Autenticación: Cablea middleware de tokens en tiempo constante
 * 5. Rutas: Registra endpoints HTTP (/api/analyze, /health, etc)
 * 6. Escucha: Abre puerto y acepta conexiones entrantes
 *
 * Variables de entorno:
 * - PORT: Puerto a escuchar (default: 3000)
 * - HOST: Host/interfaz (default: 0.0.0.0)
 * - DEVSHIELD_API_TOKEN: Token API requerido (default: dev-token)
 * - LOG_LEVEL: Nivel de logging (debug, info, warn, error)
 */

import Fastify from "fastify";
import fastifyIO from "fastify-socket.io";
import { registerRoutes } from "./server/routes";
import { setupWebSockets } from "./server/websocket";
import { authMiddleware } from "./middleware/auth";

// Configuración desde variables de entorno
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

/**
 * Función principal que inicia el servidor.
 */
async function startServer() {
  console.log(`
╔════════════════════════════════════════╗
║  🛡️  DevShield - Iniciando...          ║
║  Entorno: ${ENV.padEnd(23)}║
║  Puerto: ${String(PORT).padEnd(28)}║
╚════════════════════════════════════════╝
  `);

  try {
    // 1. Crear instancia de Fastify
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

    // 2. Registrar Socket.io
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

    // 3. Registrar middleware de autenticación
    app.addHook("onRequest", authMiddleware);
    console.log("✓ Middleware de autenticación activo");

    // 4. Registrar rutas HTTP
    await registerRoutes(app);
    console.log("✓ Rutas HTTP registradas");

    // 5. Configurar WebSockets
    const io = await setupWebSockets(app);
    console.log("✓ WebSockets configurados");

    // 6. Iniciar servidor
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

    // Graceful shutdown
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

// Punto de entrada
startServer().catch((err) => {
  console.error("❌ Error no capturado:", err);
  process.exit(1);
});
