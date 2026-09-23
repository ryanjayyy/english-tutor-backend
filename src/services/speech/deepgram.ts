import { AppError, timeout, upstream } from '../../lib/errors.js';
import type { AudioInput, SpeechToTextService, TranscribedWord, Transcription } from './types.js';

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  confidence: number;
  start: number;
  end: number;
}

interface DeepgramResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{ alternatives?: Array<{ transcript?: string; words?: DeepgramWord[] }> }>;
  };
}

interface DeepgramOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

/** Deepgram pre-recorded transcription (https://developers.deepgram.com/reference/listen-file). */
export class DeepgramSpeechToText implements SpeechToTextService {
  constructor(private readonly options: DeepgramOptions) {}

  async transcribe(audio: AudioInput): Promise<Transcription> {
    const params = new URLSearchParams({
      model: this.options.model,
      language: 'en',
      punctuate: 'true',
      // Keep the learner's words as spoken: no number/format rewriting.
      smart_format: 'false',
    });

    let response: Response;
    try {
      response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.options.apiKey}`,
          'Content-Type': audio.mimeType,
        },
        body: new Uint8Array(audio.data),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw timeout('Speech recognition took too long. Please try again.', 'STT_TIMEOUT');
      }
      throw upstream('Could not reach the speech recognition service.', 'STT_UNREACHABLE', error);
    }

    if (!response.ok) {
      const status = response.status;
      const cause = `Deepgram ${status}: ${(await response.text().catch(() => '')).slice(0, 300)}`;
      if (status === 400) {
        throw new AppError(422, 'STT_BAD_AUDIO', "We couldn't process that recording. Please try again.", { cause });
      }
      throw upstream('Speech recognition failed. Please try again.', 'STT_ERROR', cause);
    }

    const body = (await response.json()) as DeepgramResponse;
    const alternative = body.results?.channels?.[0]?.alternatives?.[0];
    const words: TranscribedWord[] = (alternative?.words ?? []).map((word) => ({
      word: word.punctuated_word ?? word.word,
      confidence: word.confidence,
      start: word.start,
      end: word.end,
    }));

    return {
      text: (alternative?.transcript ?? '').trim(),
      durationSeconds: body.metadata?.duration ?? words.at(-1)?.end ?? 0,
      words,
    };
  }
}
