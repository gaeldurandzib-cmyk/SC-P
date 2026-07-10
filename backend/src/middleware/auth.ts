import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

const VALID_API_TOKEN = process.env.DEVSHIELD_API_TOKEN || "devshield-secret-token-dev";

const PUBLIC_ROUTES = ["/health"];

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
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

  const providedToken = authHeader.slice(7);

  try {
    const provided = Buffer.from(providedToken);
    const expected = Buffer.from(VALID_API_TOKEN);

    if (provided.length !== expected.length) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.random() * 10)
      );
      throw new Error("Invalid token");
    }

    if (!timingSafeEqual(provided, expected)) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.random() * 10)
      );
      throw new Error("Invalid token");
    }
  } catch (err) {
    return reply.status(401).send({
      error: "Unauthorized: Invalid credentials",
      code: "AUTH_INVALID",
    });
  }
}

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
