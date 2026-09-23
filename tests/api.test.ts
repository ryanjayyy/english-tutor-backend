import 'dotenv/config';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { createPrisma, type Db } from '../src/db.js';
import type { EnglishAnalysis } from '../src/domain/types.js';
import type { EnglishTutorService } from '../src/services/tutor/types.js';

/**
 * End-to-end API test against a real Postgres (DATABASE_URL) with fake AI and
 * speech providers, so it runs offline and without API keys.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const analysis: EnglishAnalysis = {
  isCorrect: false,
  correction: 'I went to the market yesterday and bought some food.',
  mistakes: [
    { original: 'go', corrected: 'went', type: 'grammar', category: 'verb_tense', explanation: 'Use the past tense for yesterday.' },
    { original: 'buy', corrected: 'bought', type: 'grammar', category: 'verb_tense', explanation: 'Use the past tense here too.' },
    { original: 'foods', corrected: 'food', type: 'vocabulary', category: 'plurals', explanation: '"Food" is usually uncountable.' },
  ],
  naturalVersion: 'I went to the market yesterday and bought some food.',
  feedback: 'Good sentence. You communicated your idea clearly.',
  reply: 'Nice!',
  nextQuestion: 'What did you buy at the market?',
  estimatedLevel: 'A2',
};

const fakeTutor: EnglishTutorService = {
  startConversation: async ({ topic }) => ({ message: `Hi! Let's talk about ${topic}. What did you do today?` }),
  analyzeResponse: async () => analysis,
};

describe.skipIf(!databaseUrl)('API', () => {
  let app: FastifyInstance;
  let db: Db;

  beforeAll(async () => {
    db = createPrisma(databaseUrl!);
    app = await buildApp(
      { JWT_SECRET: 'x'.repeat(40), JWT_EXPIRES_IN: '1h', CORS_ORIGINS: [] },
      {
        db,
        tutor: fakeTutor,
        speech: {
          transcribe: async () => ({
            text: 'I go to the market yesterday',
            durationSeconds: 2.5,
            words: ['I', 'go', 'to', 'the', 'market', 'yesterday'].map((word) => ({ word, confidence: 0.9, start: 0, end: 0 })),
          }),
        },
        pronunciation: { analyze: async () => ({ score: 90, label: 'Very clear', wordsToPractice: [], source: 'test' }) },
        social: {
          verifyApple: async () => ({ subject: 'apple-sub', email: null, name: null }),
          verifyGoogle: async () => ({ subject: 'google-sub', email: null, name: 'G User' }),
        },
      },
      { logger: false },
    );
  });

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  it('runs a full guest → conversation → progress → upgrade flow', async () => {
    const guest = await app.inject({ method: 'POST', url: '/auth/guest' });
    expect(guest.statusCode).toBe(201);
    const { token, user } = guest.json();
    expect(user.isGuest).toBe(true);
    const auth = { authorization: `Bearer ${token}` };

    const onboarding = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: auth,
      payload: { englishLevel: null, levelIsEstimated: true, onboardingDone: true },
    });
    expect(onboarding.json().user.levelIsEstimated).toBe(true);

    const created = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: auth,
      payload: { topic: 'Daily Conversation', topicId: 'daily', mode: 'chat' },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json().session;
    expect(session.level).toBe('A2');
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].role).toBe('assistant');

    // Voice-style turn: transcribe, then send.
    const boundary = 'testboundary';
    const multipart = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="audio"; filename="answer.m4a"',
      'Content-Type: audio/mp4',
      '',
      'fake-audio-bytes',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const transcribed = await app.inject({
      method: 'POST',
      url: '/speech/transcribe',
      headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart,
    });
    expect(transcribed.statusCode).toBe(200);
    const transcription = transcribed.json();
    expect(transcription).toMatchObject({ text: 'I go to the market yesterday', wordCount: 6 });

    for (let turn = 0; turn < 3; turn++) {
      const sent = await app.inject({
        method: 'POST',
        url: `/sessions/${session.id}/messages`,
        headers: auth,
        payload: {
          text: transcription.text,
          mode: 'voice',
          speakingSeconds: transcription.durationSeconds,
          pronunciation: transcription.pronunciation,
        },
      });
      expect(sent.statusCode).toBe(201);
      const body = sent.json();
      expect(body.userMessage.analysis.correction).toBe(analysis.correction);
      expect(body.assistantMessage.text).toBe('Nice! What did you buy at the market?');
    }

    const detail = await app.inject({ method: 'GET', url: `/sessions/${session.id}`, headers: auth });
    expect(detail.json().session.messages.map((message: { role: string }) => message.role)).toEqual([
      'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant',
    ]);

    const progress = await app.inject({ method: 'GET', url: '/progress?tzOffset=480', headers: auth });
    expect(progress.json()).toMatchObject({
      streakDays: 1,
      conversations: 1,
      answers: 3,
      wordsSpoken: 18,
      speakingSeconds: 8,
      corrections: 9,
      grammarAccuracy: 0,
      averagePronunciation: 90,
      // Three A2 estimates are enough to set the estimated level.
      currentLevel: 'A2',
      estimatedLevel: 'A2',
    });

    const mistakes = await app.inject({ method: 'GET', url: '/mistakes', headers: auth });
    const categories = mistakes.json().categories;
    expect(categories[0]).toMatchObject({ category: 'verb_tense', count: 6 });
    expect(categories[1]).toMatchObject({ category: 'plurals', count: 3 });

    const list = await app.inject({ method: 'GET', url: '/sessions', headers: auth });
    expect(list.json().sessions[0]).toMatchObject({ id: session.id, answerCount: 3, mistakeCount: 9 });

    // Upgrading the guest keeps their data.
    const email = `learner-${Date.now()}@example.com`;
    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: auth,
      payload: { name: 'Learner', email, password: 'correct horse' },
    });
    expect(registered.statusCode).toBe(201);
    expect(registered.json().user).toMatchObject({ id: user.id, isGuest: false, email });

    const badLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'wrong password' } });
    expect(badLogin.statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'correct horse' } });
    expect(login.json().user.id).toBe(user.id);

    const ended = await app.inject({ method: 'POST', url: `/sessions/${session.id}/end`, headers: auth });
    expect(ended.json().session.endedAt).toBeTruthy();
    const afterEnd = await app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      headers: auth,
      payload: { text: 'hello', mode: 'chat' },
    });
    expect(afterEnd.json().error.code).toBe('SESSION_ENDED');

    const deleted = await app.inject({ method: 'DELETE', url: '/me', headers: auth });
    expect(deleted.statusCode).toBe(204);
    expect(await db.practiceSession.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rejects bad input and missing auth', async () => {
    expect((await app.inject({ method: 'GET', url: '/progress' })).statusCode).toBe(401);
    const guest = (await app.inject({ method: 'POST', url: '/auth/guest' })).json();
    const auth = { authorization: `Bearer ${guest.token}` };
    const bad = await app.inject({ method: 'POST', url: '/sessions', headers: auth, payload: { topic: '', mode: 'video' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
    const missing = await app.inject({ method: 'GET', url: '/sessions/00000000-0000-4000-8000-000000000000', headers: auth });
    expect(missing.statusCode).toBe(404);
    await app.inject({ method: 'DELETE', url: '/me', headers: auth });
  });
});
