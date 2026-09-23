import { describe, expect, it } from 'vitest';

import { loadEnv } from '../src/config/env.js';

const base = {
  DATABASE_URL: 'postgres://localhost/test',
  JWT_SECRET: 'x'.repeat(40),
  SPEECH_TO_TEXT_API_KEY: 'stt-key',
};

describe('loadEnv AI provider', () => {
  it('defaults to Claude and requires its key', () => {
    expect(() => loadEnv(base)).toThrow(/AI_API_KEY is required when AI_PROVIDER=claude/);
    expect(loadEnv({ ...base, AI_API_KEY: 'sk' }).AI_PROVIDER).toBe('claude');
  });

  it('requires only the Gemini key when Gemini is selected', () => {
    expect(() => loadEnv({ ...base, AI_PROVIDER: 'gemini' })).toThrow(/GEMINI_API_KEY is required/);
    const env = loadEnv({ ...base, AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'g' });
    expect(env.GEMINI_MODEL).toBe('gemini-3.1-flash-lite');
  });
});
