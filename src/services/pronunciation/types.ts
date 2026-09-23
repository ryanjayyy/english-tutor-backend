import type { PronunciationResult } from '../../domain/types.js';
import type { AudioInput, Transcription } from '../speech/types.js';

/**
 * Pronunciation analysis is separate from grammar correction. A dedicated
 * pronunciation-assessment API can implement this interface later and be
 * swapped in at startup without touching routes or the app.
 */
export interface PronunciationAnalyzer {
  analyze(input: { audio: AudioInput; transcription: Transcription }): Promise<PronunciationResult | null>;
}
