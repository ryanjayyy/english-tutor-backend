import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppServices } from '../context.js';
import { EnglishLevelSchema, MISTAKE_CATEGORIES, PracticeModeSchema } from '../domain/types.js';
import { parseInput } from '../lib/validation.js';

const TurnSchema = z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) });

const ConversationSchema = z.object({
  topic: z.string().trim().min(1).max(120),
  level: EnglishLevelSchema,
  focus: z.enum(MISTAKE_CATEGORIES).optional(),
});

const AnalyzeSchema = ConversationSchema.extend({
  userMessage: z.string().trim().min(1).max(2000),
  conversationHistory: z.array(TurnSchema).max(40).default([]),
  mode: PracticeModeSchema.default('chat'),
});

/**
 * Stateless tutor endpoints. The app uses the session endpoints (which also persist
 * history and stats); these are useful for integrations and quick experiments.
 */
export async function aiRoutes(app: FastifyInstance, { tutor }: AppServices) {
  app.addHook('preHandler', app.authenticate);

  app.post('/ai/conversation', async (request) => {
    const input = parseInput(ConversationSchema, request.body);
    return tutor.startConversation(input);
  });

  app.post('/ai/analyze', async (request) => {
    const input = parseInput(AnalyzeSchema, request.body);
    const analysis = await tutor.analyzeResponse(input.userMessage, input.conversationHistory, input);
    return { analysis };
  });
}
