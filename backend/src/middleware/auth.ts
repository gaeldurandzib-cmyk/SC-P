/**
 * middleware/auth.ts
 *
 * Middleware de autenticación para DevShield. Implementa verificación de tokens
 * en tiempo constante usando timingSafeEqual de Node.js para evitar ataques
 * de temporización (timing attacks).
 *
 * Uso:
 * - En Fastify: app.addHook("onRequest", authMiddleware)
 * - Requiere header: Authorization: Bearer <token>
 */

import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Token válido cargado desde variables de entorno.
 * En producción, esto vendría del vault/KeyRing.
 */
const VALID_API_TOKEN = process.env.DEVSHIELD_API_TOKEN || "devshield-secret-token-dev";

/**
 * Rutas que NO requieren autenticación.
 * /health es pública para verificación de estado del servicio.
 */
const PUBLIC_ROUTES = ["/health"];

/**
 * authMiddleware - Valida el token Bearer en tiempo constante.
 *
 * Detecta ataques de temporización comparando buffers de igual longitud
 * sin revelar información sobre en qué byte falló la comparación.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Permitir rutas públicas
  if (PUBLIC_ROUTES.includes(request.url)) {
    return;
  }

  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return reply.status(401).send({
      error: "Unauthorized: Missing or invalid Authorization header",
      code: "AUTH_MISSING",
    });
  }

  const providedToken = authHeader.slice(7); // Quitar "Bearer "

  try {
    // Convertir ambos a buffers
    const provided = Buffer.from(providedToken);
    const expected = Buffer.from(VALID_API_TOKEN);

    // CRÍTICO: timingSafeEqual requiere que ambos buffers tengan la misma longitud.
    // Si difieren, lanzamos un error genérico para no revelar información.
    if (provided.length !== expected.length) {
      // Pequeña pausa aleatoria para evitar timing side-channel
      await new Promise((resolve) =>
        setTimeout(resolve, Math.random() * 10)
      );
      throw new Error("Invalid token");
    }

    // Comparación en tiempo constante: NUNCA revela en qué posición falló
    if (!timingSafeEqual(provided, expected)) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.random() * 10)
      );
      throw new Error("Invalid token");
    }

    // Token válido, continuar
  } catch (err) {
    // No revelar detalles del error (timing-safe)
    return reply.status(401).send({
      error: "Unauthorized: Invalid credentials",
      code: "AUTH_INVALID",
    });
  }
}

/**
 * safeEqual - Wrapper público para comparación segura de strings.
 *
 * Útil para otros contextos donde se necesita evitar timing attacks.
 * Retorna true/false sin revelar en qué posición falló.
 */
export function safeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);

    if (bufA.length !== bufB.length) {
      return false;
    }

    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
