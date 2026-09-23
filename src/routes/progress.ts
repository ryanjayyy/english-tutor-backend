import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppServices } from '../context.js';
import type { EnglishLevel } from '../domain/types.js';
import { parseInput } from '../lib/validation.js';
import { computeStreak, estimateLevel, grammarAccuracy, weeklyTrend } from '../services/stats.js';

const ProgressQuery = z.object({
  /** Client UTC offset in minutes (UTC+8 => 480) so streaks follow the learner's calendar. */
  tzOffset: z.coerce.number().int().min(-840).max(840).default(0),
});

const HISTORY_DAYS = 366;

export async function progressRoutes(app: FastifyInstance, { db }: AppServices) {
  app.addHook('preHandler', app.authenticate);

  app.get('/progress', async (request) => {
    const { tzOffset } = parseInput(ProgressQuery, request.query);
    const userId = request.userId;
    const now = new Date();
    const since = new Date(now.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
    const userMessages = { session: { userId }, role: 'user' as const };

    const [user, conversations, voiceTotals, chatTotals, corrections, pronunciation, recent, levels] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: userId } }),
      db.practiceSession.count({ where: { userId, messages: { some: { role: 'user' } } } }),
      db.message.aggregate({ where: { ...userMessages, mode: 'voice' }, _sum: { wordCount: true, speakingSeconds: true } }),
      db.message.aggregate({ where: { ...userMessages, mode: 'chat' }, _sum: { wordCount: true } }),
      db.mistake.count({ where: { userId } }),
      db.message.aggregate({ where: { ...userMessages, pronunciationScore: { not: null } }, _avg: { pronunciationScore: true } }),
      db.message.findMany({
        where: { ...userMessages, timestamp: { gte: since } },
        select: { timestamp: true, grammarMistakes: true },
      }),
      db.message.findMany({
        where: { ...userMessages, estimatedLevel: { not: null } },
        orderBy: { timestamp: 'desc' },
        take: 20,
        select: { estimatedLevel: true },
      }),
    ]);

    const estimated = estimateLevel(levels.map((message) => message.estimatedLevel as EnglishLevel));

    return {
      streakDays: computeStreak(recent.map((message) => message.timestamp), now, tzOffset),
      conversations,
      answers: recent.length,
      wordsSpoken: voiceTotals._sum.wordCount ?? 0,
      wordsWritten: chatTotals._sum.wordCount ?? 0,
      speakingSeconds: Math.round(voiceTotals._sum.speakingSeconds ?? 0),
      corrections,
      grammarAccuracy: grammarAccuracy(recent),
      averagePronunciation: pronunciation._avg.pronunciationScore === null ? null : Math.round(pronunciation._avg.pronunciationScore),
      currentLevel: user.englishLevel,
      levelIsEstimated: user.levelIsEstimated,
      estimatedLevel: estimated,
      weekly: weeklyTrend(recent, now, tzOffset),
    };
  });

  app.get('/mistakes', async (request) => {
    const userId = request.userId;
    const groups = await db.mistake.groupBy({
      by: ['category'],
      where: { userId },
      _count: { _all: true },
      orderBy: { _count: { category: 'desc' } },
    });
    const categories = await Promise.all(
      groups.map(async (group) => ({
        category: group.category,
        count: group._count._all,
        examples: await db.mistake.findMany({
          where: { userId, category: group.category },
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { id: true, original: true, corrected: true, explanation: true, type: true, createdAt: true },
        }),
      })),
    );
    return { categories };
  });
}
