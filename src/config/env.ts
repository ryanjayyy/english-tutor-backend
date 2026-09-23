import 'dotenv/config';
import { z } from 'zod';

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('30d'),
  /** Which tutor to use: "claude" (paid Anthropic API) or "gemini" (Google, has a free tier). */
  AI_PROVIDER: z.enum(['claude', 'gemini']).default('claude'),
  /** Anthropic API key (AI_PROVIDER=claude). */
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5'),
  /** Google AI Studio API key (AI_PROVIDER=gemini). */
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.1-flash-lite'),
  SPEECH_TO_TEXT_API_KEY: z.string().min(1, 'SPEECH_TO_TEXT_API_KEY is required'),
  SPEECH_TO_TEXT_MODEL: z.string().default('nova-3'),
  /** Comma-separated OAuth client IDs (iOS, Android, web) accepted as Google ID token audiences. */
  GOOGLE_CLIENT_IDS: csv,
  /** Comma-separated iOS bundle IDs / Services IDs accepted as Apple identity token audiences. */
  APPLE_AUDIENCES: csv,
  /** Comma-separated allowed CORS origins. Native apps don't send Origin; this only matters for web. */
  CORS_ORIGINS: csv,
}).superRefine((env, ctx) => {
  const required = env.AI_PROVIDER === 'gemini' ? 'GEMINI_API_KEY' : 'AI_API_KEY';
  if (!env[required]) {
    ctx.addIssue({ code: 'custom', path: [required], message: `${required} is required when AI_PROVIDER=${env.AI_PROVIDER}` });
  }
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  return parsed.data;
}
