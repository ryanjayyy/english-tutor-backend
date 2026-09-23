import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppServices } from '../context.js';
import {
  EnglishLevelSchema,
  MISTAKE_CATEGORIES,
  PracticeModeSchema,
  type ConversationTurn,
  type EnglishLevel,
} from '../domain/types.js';
import { badRequest, notFound } from '../lib/errors.js';
import { toMessageDto, toSessionDto } from '../lib/dto.js';
import { parseInput } from '../lib/validation.js';
import { countWords, estimateLevel } from '../services/stats.js';

const DEFAULT_LEVEL: EnglishLevel = 'A2';
const LEVEL_SAMPLE_SIZE = 20;

const CreateSessionSchema = z.object({
  topic: z.string().trim().min(1).max(120),
  topicId: z.string().max(60).optional(),
  mode: PracticeModeSchema,
  level: EnglishLevelSchema.optional(),
  focus: z.enum(MISTAKE_CATEGORIES).optional(),
});

const ListSessionsSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

const PronunciationSchema = z.object({
  score: z.number().min(0).max(100),
  label: z.string().max(200),
  wordsToPractice: z.array(z.string().max(60)).max(10),
  source: z.string().max(60),
});

const SendMessageSchema = z.object({
  text: z.string().trim().min(1, 'Please say or type something first.').max(2000),
  mode: PracticeModeSchema,
  speakingSeconds: z.number().min(0).max(600).optional(),
  pronunciation: PronunciationSchema.optional(),
});

const IdParams = z.object({ id: z.uuid() });

export async function sessionRoutes(app: FastifyInstance, { db, tutor }: AppServices) {
  app.addHook('preHandler', app.authenticate);

  async function ownedSession(userId: string, sessionId: string) {
    const session = await db.practiceSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw notFound('Conversation not found.', 'SESSION_NOT_FOUND');
    return session;
  }

  app.post('/sessions', async (request, reply) => {
    const input = parseInput(CreateSessionSchema, request.body);
    const user = await db.user.findUniqueOrThrow({ where: { id: request.userId } });
    const level = input.level ?? user.englishLevel ?? DEFAULT_LEVEL;

    // Generate the opener first so a tutor failure doesn't leave an empty session behind.
    const opening = await tutor.startConversation({ level, topic: input.topic, focus: input.focus });
    const session = await db.practiceSession.create({
      data: {
        userId: user.id,
        topic: input.topic,
        topicId: input.topicId,
        focus: input.focus,
        mode: input.mode,
        level,
        messages: { create: { role: 'assistant', text: opening.message } },
      },
      include: { messages: true },
    });
    reply.code(201);
    return { session: toSessionDto(session) };
  });

  app.get('/sessions', async (request) => {
    const { limit } = parseInput(ListSessionsSchema, request.query);
    const sessions = await db.practiceSession.findMany({
      where: { userId: request.userId, messages: { some: { role: 'user' } } },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: { _count: { select: { messages: { where: { role: 'user' } }, mistakes: true } } },
    });
    return {
      sessions: sessions.map((session) => ({
        ...toSessionDto(session),
        answerCount: session._count.messages,
        mistakeCount: session._count.mistakes,
      })),
    };
  });

  app.get('/sessions/:id', async (request) => {
    const { id } = parseInput(IdParams, request.params);
    await ownedSession(request.userId, id);
    const session = await db.practiceSession.findUniqueOrThrow({
      where: { id },
      include: { messages: { orderBy: { timestamp: 'asc' } } },
    });
    return { session: toSessionDto(session) };
  });

  app.post('/sessions/:id/end', async (request) => {
    const { id } = parseInput(IdParams, request.params);
    const session = await ownedSession(request.userId, id);
    const ended = session.endedAt
      ? session
      : await db.practiceSession.update({ where: { id }, data: { endedAt: new Date() } });
    return { session: toSessionDto(ended) };
  });

  /** One conversation turn: analyze the learner's answer, save it, and reply with the next question. */
  app.post('/sessions/:id/messages', async (request, reply) => {
    const { id } = parseInput(IdParams, request.params);
    const input = parseInput(SendMessageSchema, request.body);
    const session = await ownedSession(request.userId, id);
    if (session.endedAt) throw badRequest('This conversation has ended. Start a new one to keep practicing.', 'SESSION_ENDED');

    const previous = await db.message.findMany({
      where: { sessionId: id },
      orderBy: { timestamp: 'desc' },
      take: 20,
      select: { role: true, text: true },
    });
    const history: ConversationTurn[] = previous.reverse();

    const analysis = await tutor.analyzeResponse(input.text, history, {
      level: session.level,
      topic: session.topic,
      focus: (session.focus as (typeof MISTAKE_CATEGORIES)[number] | null) ?? undefined,
      mode: input.mode,
    });

    const isVoice = input.mode === 'voice';
    const now = Date.now();
    const [userMessage, assistantMessage] = await db.$transaction(async (tx) => {
      const userMessage = await tx.message.create({
        data: {
          sessionId: id,
          role: 'user',
          text: input.text,
          mode: input.mode,
          timestamp: new Date(now),
          analysis,
          pronunciation: isVoice ? input.pronunciation : undefined,
          pronunciationScore: isVoice ? input.pronunciation?.score : undefined,
          wordCount: countWords(input.text),
          speakingSeconds: isVoice ? (input.speakingSeconds ?? 0) : 0,
          estimatedLevel: analysis.estimatedLevel ?? undefined,
          grammarMistakes: analysis.mistakes.filter((mistake) => mistake.type === 'grammar').length,
        },
      });
      if (analysis.mistakes.length > 0) {
        await tx.mistake.createMany({
          data: analysis.mistakes.map((mistake) => ({
            userId: request.userId,
            sessionId: id,
            messageId: userMessage.id,
            original: mistake.original,
            corrected: mistake.corrected,
            type: mistake.type,
            category: mistake.category,
            explanation: mistake.explanation,
          })),
        });
      }
      const assistantMessage = await tx.message.create({
        data: {
          sessionId: id,
          role: 'assistant',
          text: [analysis.reply, analysis.nextQuestion].filter(Boolean).join(' '),
          // Strictly after the user message so ordering is stable.
          timestamp: new Date(now + 1),
        },
      });
      return [userMessage, assistantMessage] as const;
    });

    const user = await db.user.findUniqueOrThrow({ where: { id: request.userId } });
    let updatedLevel: EnglishLevel | null = null;
    if (user.levelIsEstimated) {
      const recent = await db.message.findMany({
        where: { session: { userId: user.id }, role: 'user', estimatedLevel: { not: null } },
        orderBy: { timestamp: 'desc' },
        take: LEVEL_SAMPLE_SIZE,
        select: { estimatedLevel: true },
      });
      updatedLevel = estimateLevel(recent.map((message) => message.estimatedLevel!));
      if (updatedLevel && updatedLevel !== user.englishLevel) {
        await db.user.update({ where: { id: user.id }, data: { englishLevel: updatedLevel } });
      }
    }

    reply.code(201);
    return {
      userMessage: toMessageDto(userMessage),
      assistantMessage: toMessageDto(assistantMessage),
      englishLevel: updatedLevel ?? user.englishLevel,
    };
  });
}
