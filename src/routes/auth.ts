import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AppServices } from '../context.js';
import { EnglishLevelSchema } from '../domain/types.js';
import type { User } from '../generated/prisma/client.js';
import { conflict, notFound, unauthorized } from '../lib/errors.js';
import { toUserDto } from '../lib/dto.js';
import { parseInput } from '../lib/validation.js';
import type { SocialIdentity } from '../services/socialAuth.js';

const EmailSchema = z.email().max(254).transform((email) => email.toLowerCase());

const RegisterSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: EmailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const LoginSchema = z.object({ email: EmailSchema, password: z.string().min(1).max(128) });

const AppleSchema = z.object({
  identityToken: z.string().min(1),
  name: z.string().trim().max(80).optional(),
});

const GoogleSchema = z.object({ idToken: z.string().min(1) });

const UpdateMeSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    englishLevel: EnglishLevelSchema.nullable(),
    levelIsEstimated: z.boolean(),
    onboardingDone: z.boolean(),
  })
  .partial();

export async function authRoutes(app: FastifyInstance, { db, social }: AppServices) {
  const authResponse = (user: User) => ({ token: app.issueToken(user.id), user: toUserDto(user) });

  /** If the caller is signed in as a guest, returns that guest so their progress carries over. */
  async function currentGuest(request: FastifyRequest): Promise<User | null> {
    if (!request.headers.authorization) return null;
    try {
      const payload = await request.jwtVerify<{ sub: string }>();
      const user = await db.user.findUnique({ where: { id: payload.sub } });
      return user?.isGuest ? user : null;
    } catch {
      return null;
    }
  }

  async function signInWithSocial(
    request: FastifyRequest,
    provider: 'appleId' | 'googleId',
    identity: SocialIdentity,
    fallbackName?: string,
  ) {
    const existing = await db.user.findFirst({ where: { [provider]: identity.subject } });
    if (existing) return authResponse(existing);

    // Link to an existing account with the same provider-verified email.
    if (identity.email) {
      const byEmail = await db.user.findUnique({ where: { email: identity.email } });
      if (byEmail) {
        const linked = await db.user.update({ where: { id: byEmail.id }, data: { [provider]: identity.subject } });
        return authResponse(linked);
      }
    }

    const name = identity.name ?? fallbackName ?? null;
    const guest = await currentGuest(request);
    const user = guest
      ? await db.user.update({
          where: { id: guest.id },
          data: { [provider]: identity.subject, email: identity.email, name: name ?? guest.name, isGuest: false },
        })
      : await db.user.create({ data: { [provider]: identity.subject, email: identity.email, name } });
    return authResponse(user);
  }

  app.post('/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = parseInput(RegisterSchema, request.body);
    if (await db.user.findUnique({ where: { email: input.email } })) {
      throw conflict('An account with this email already exists.', 'EMAIL_TAKEN');
    }
    const passwordHash = await bcrypt.hash(input.password, 12);
    const guest = await currentGuest(request);
    const data = { name: input.name, email: input.email, passwordHash, isGuest: false };
    const user = guest
      ? await db.user.update({ where: { id: guest.id }, data })
      : await db.user.create({ data });
    reply.code(201);
    return authResponse(user);
  });

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const input = parseInput(LoginSchema, request.body);
    const user = await db.user.findUnique({ where: { email: input.email } });
    const valid = user?.passwordHash ? await bcrypt.compare(input.password, user.passwordHash) : false;
    if (!user || !valid) throw unauthorized('Incorrect email or password.', 'INVALID_CREDENTIALS');
    return authResponse(user);
  });

  app.post('/auth/guest', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (_request, reply) => {
    const user = await db.user.create({ data: { isGuest: true } });
    reply.code(201);
    return authResponse(user);
  });

  app.post('/auth/apple', async (request) => {
    const input = parseInput(AppleSchema, request.body);
    const identity = await social.verifyApple(input.identityToken);
    return signInWithSocial(request, 'appleId', identity, input.name);
  });

  app.post('/auth/google', async (request) => {
    const input = parseInput(GoogleSchema, request.body);
    const identity = await social.verifyGoogle(input.idToken);
    return signInWithSocial(request, 'googleId', identity);
  });

  app.get('/me', { preHandler: app.authenticate }, async (request) => {
    const user = await db.user.findUnique({ where: { id: request.userId } });
    if (!user) throw unauthorized('Account not found. Please sign in again.', 'USER_NOT_FOUND');
    return { user: toUserDto(user) };
  });

  app.patch('/me', { preHandler: app.authenticate }, async (request) => {
    const input = parseInput(UpdateMeSchema, request.body);
    const user = await db.user.update({ where: { id: request.userId }, data: input });
    return { user: toUserDto(user) };
  });

  // Required by the App Store for apps that support account creation.
  app.delete('/me', { preHandler: app.authenticate }, async (request, reply) => {
    const deleted = await db.user.deleteMany({ where: { id: request.userId } });
    if (deleted.count === 0) throw notFound('Account not found.');
    reply.code(204);
  });
}
