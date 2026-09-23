import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';

import type { Env } from './config/env.js';
import type { AppServices } from './context.js';
import { AppError } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import { aiRoutes } from './routes/ai.js';
import { authRoutes } from './routes/auth.js';
import { progressRoutes } from './routes/progress.js';
import { sessionRoutes } from './routes/sessions.js';
import { speechRoutes } from './routes/speech.js';

type AppConfig = Pick<Env, 'JWT_SECRET' | 'JWT_EXPIRES_IN' | 'CORS_ORIGINS'>;

export async function buildApp(config: AppConfig, services: AppServices, options: FastifyServerOptions = {}) {
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024, ...options });

  await app.register(cors, {
    origin: config.CORS_ORIGINS.length > 0 ? config.CORS_ORIGINS : false,
    // @fastify/cors only allows GET/HEAD/POST by default.
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
  });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(multipart);
  await app.register(authPlugin, { secret: config.JWT_SECRET, expiresIn: config.JWT_EXPIRES_IN });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        // Log the provider's own error (e.g. "credit balance is too low") so the cause is visible.
        const cause = error.cause instanceof Error ? error.cause.message : error.cause;
        request.log.error({ code: error.code, cause }, error.message);
      }
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) {
      return reply.code(statusCode).send({ error: { code: 'REQUEST_ERROR', message: (error as Error).message } });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(async (scope) => authRoutes(scope, services));
  await app.register(async (scope) => sessionRoutes(scope, services));
  await app.register(async (scope) => aiRoutes(scope, services));
  await app.register(async (scope) => speechRoutes(scope, services));
  await app.register(async (scope) => progressRoutes(scope, services));

  return app;
}
