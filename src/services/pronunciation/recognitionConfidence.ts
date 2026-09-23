import type { PronunciationResult } from '../../domain/types.js';
import type { Transcription } from '../speech/types.js';
import type { PronunciationAnalyzer } from './types.js';

const LOW_CONFIDENCE = 0.8;
const MAX_WORDS_TO_PRACTICE = 5;
const MIN_WORDS_FOR_SCORE = 3;

/**
 * Estimates speaking clarity from how confidently the speech recognizer heard
 * each word. It is not phoneme-level pronunciation assessment, and the UI says so.
 */
export class RecognitionConfidenceAnalyzer implements PronunciationAnalyzer {
  async analyze({ transcription }: { transcription: Transcription }): Promise<PronunciationResult | null> {
    return scoreFromTranscription(transcription);
  }
}

export function scoreFromTranscription(transcription: Transcription): PronunciationResult | null {
  const words = transcription.words.filter((word) => normalizeWord(word.word).length > 0);
  if (words.length < MIN_WORDS_FOR_SCORE) return null;

  const average = words.reduce((sum, word) => sum + word.confidence, 0) / words.length;
  const score = Math.round(Math.min(1, Math.max(0, average)) * 100);

  const wordsToPractice: string[] = [];
  const sorted = [...words].sort((a, b) => a.confidence - b.confidence);
  for (const word of sorted) {
    if (word.confidence >= LOW_CONFIDENCE) break;
    const normalized = normalizeWord(word.word);
    // Short function words are usually low-confidence because they're unstressed, not mispronounced.
    if (normalized.length < 4 || wordsToPractice.includes(normalized)) continue;
    wordsToPractice.push(normalized);
    if (wordsToPractice.length === MAX_WORDS_TO_PRACTICE) break;
  }

  return { score, label: labelFor(score), wordsToPractice, source: 'recognition-confidence' };
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z'-]/g, '');
}

function labelFor(score: number): string {
  if (score >= 90) return 'Very clear pronunciation!';
  if (score >= 75) return 'Good pronunciation!';
  if (score >= 60) return 'Mostly clear. Keep practicing!';
  return 'Try speaking a little more slowly and clearly.';
}
