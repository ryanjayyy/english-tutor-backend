import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { unauthorized } from '../lib/errors.js';

export interface TokenPayload {
  sub: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    issueToken: (userId: string) => string;
  }
  interface FastifyRequest {
    userId: string;
  }
}

export default fp<{ secret: string; expiresIn: string }>(async (app: FastifyInstance, options) => {
  await app.register(jwt, { secret: options.secret, sign: { expiresIn: options.expiresIn } });

  app.decorateRequest('userId', '');
  app.decorate('issueToken', (userId: string) => app.jwt.sign({ sub: userId }));
  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      const payload = await request.jwtVerify<TokenPayload>();
      request.userId = payload.sub;
    } catch {
      throw unauthorized('Your session has expired. Please sign in again.', 'INVALID_TOKEN');
    }
  });
});
