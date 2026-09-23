import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPrisma } from './db.js';
import { RecognitionConfidenceAnalyzer } from './services/pronunciation/recognitionConfidence.js';
import { JwksSocialTokenVerifier } from './services/socialAuth.js';
import { DeepgramSpeechToText } from './services/speech/deepgram.js';
import { ClaudeEnglishTutor } from './services/tutor/claudeTutor.js';
import { GeminiEnglishTutor } from './services/tutor/geminiTutor.js';

const env = loadEnv();
const db = createPrisma(env.DATABASE_URL);

// loadEnv() guarantees the selected provider's key is present.
const tutor =
  env.AI_PROVIDER === 'gemini'
    ? new GeminiEnglishTutor({ apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL })
    : new ClaudeEnglishTutor({ apiKey: env.AI_API_KEY!, model: env.AI_MODEL });

const app = await buildApp(env, {
  db,
  tutor,
  speech: new DeepgramSpeechToText({ apiKey: env.SPEECH_TO_TEXT_API_KEY, model: env.SPEECH_TO_TEXT_MODEL }),
  pronunciation: new RecognitionConfidenceAnalyzer(),
  social: new JwksSocialTokenVerifier({ appleAudiences: env.APPLE_AUDIENCES, googleClientIds: env.GOOGLE_CLIENT_IDS }),
});

const shutdown = async () => {
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: env.PORT, host: env.HOST });
app.log.info(`AI tutor: ${env.AI_PROVIDER} (${env.AI_PROVIDER === 'gemini' ? env.GEMINI_MODEL : env.AI_MODEL})`);
