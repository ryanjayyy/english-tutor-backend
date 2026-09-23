import { describe, expect, it } from 'vitest';

import { scoreFromTranscription } from '../src/services/pronunciation/recognitionConfidence.js';

const word = (text: string, confidence: number) => ({ word: text, confidence, start: 0, end: 0 });

describe('scoreFromTranscription', () => {
  it('scores average recognizer confidence and lists unclear words', () => {
    const result = scoreFromTranscription({
      text: 'I usually feel comfortable at the opportunity',
      durationSeconds: 3,
      words: [
        word('I', 0.99),
        word('usually', 0.6),
        word('feel', 0.95),
        word('comfortable', 0.5),
        word('at', 0.4),
        word('the', 0.97),
        word('opportunity,', 0.7),
      ],
    });
    expect(result?.score).toBe(73);
    // Short function words like "at" are skipped.
    expect(result?.wordsToPractice).toEqual(['comfortable', 'usually', 'opportunity']);
    expect(result?.source).toBe('recognition-confidence');
  });

  it('returns null for very short answers', () => {
    expect(scoreFromTranscription({ text: 'yes', durationSeconds: 1, words: [word('yes', 0.9)] })).toBeNull();
  });
});
