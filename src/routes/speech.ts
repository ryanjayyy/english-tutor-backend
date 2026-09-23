import type { FastifyInstance } from 'fastify';

import type { AppServices } from '../context.js';
import { AppError, badRequest } from '../lib/errors.js';
import { countWords } from '../services/stats.js';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = /^(audio\/|video\/mp4$|application\/octet-stream$)/;

export async function speechRoutes(app: FastifyInstance, { speech, pronunciation }: AppServices) {
  app.addHook('preHandler', app.authenticate);

  app.post(
    '/speech/transcribe',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const file = await request.file({ limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } });
      if (!file) throw badRequest('No recording was uploaded.', 'NO_AUDIO');
      if (!ALLOWED_TYPES.test(file.mimetype)) throw badRequest('Unsupported audio format.', 'UNSUPPORTED_AUDIO');

      const data = await file.toBuffer();
      if (file.file.truncated) throw new AppError(413, 'AUDIO_TOO_LARGE', 'That recording is too long. Please keep answers under a few minutes.');
      if (data.length === 0) throw badRequest('The recording was empty.', 'EMPTY_AUDIO');

      // Some Android recorders label m4a as octet-stream; Deepgram sniffs the container either way.
      const audio = { data, mimeType: file.mimetype === 'application/octet-stream' ? 'audio/mp4' : file.mimetype };
      const transcription = await speech.transcribe(audio);
      if (!transcription.text) {
        throw new AppError(422, 'EMPTY_TRANSCRIPTION', "We couldn't understand the recording. Please try again.");
      }

      // Pronunciation is best-effort: never fail the turn because of it.
      const result = await pronunciation.analyze({ audio, transcription }).catch((error: unknown) => {
        request.log.warn({ err: error }, 'pronunciation analysis failed');
        return null;
      });

      return {
        text: transcription.text,
        durationSeconds: transcription.durationSeconds,
        wordCount: countWords(transcription.text),
        pronunciation: result,
      };
    },
  );
}
