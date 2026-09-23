import { z } from 'zod';

export const ENGLISH_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
export const EnglishLevelSchema = z.enum(ENGLISH_LEVELS);
export type EnglishLevel = z.infer<typeof EnglishLevelSchema>;

export const PracticeModeSchema = z.enum(['voice', 'chat']);
export type PracticeMode = z.infer<typeof PracticeModeSchema>;

export const MISTAKE_TYPES = ['grammar', 'vocabulary', 'spelling', 'naturalness'] as const;
export type MistakeType = (typeof MISTAKE_TYPES)[number];

/** Fine-grained categories used for the "Common Mistakes" screen and targeted practice. */
export const MISTAKE_CATEGORIES = [
  'verb_tense',
  'articles',
  'prepositions',
  'subject_verb_agreement',
  'plurals',
  'word_order',
  'word_choice',
  'pronouns',
  'spelling',
  'naturalness',
  'other',
] as const;
export type MistakeCategory = (typeof MISTAKE_CATEGORIES)[number];

export const MistakeSchema = z.object({
  original: z.string().describe('The exact wrong word or phrase from the learner, as short as possible.'),
  corrected: z.string().describe('The corrected word or phrase.'),
  // Tolerate an unexpected label instead of failing the whole turn.
  type: z.enum(MISTAKE_TYPES).catch('grammar'),
  category: z.enum(MISTAKE_CATEGORIES).catch('other'),
  explanation: z.string().describe('One or two short sentences in simple English, adapted to the learner level.'),
});
export type Mistake = z.infer<typeof MistakeSchema>;

export const EnglishAnalysisSchema = z.object({
  isCorrect: z.boolean().describe('True when there are no meaningful mistakes worth correcting.'),
  correction: z.string().describe("The learner's sentence with only the important mistakes fixed. Same as the original when correct."),
  mistakes: z.array(MistakeSchema),
  naturalVersion: z.string().describe('How a native speaker would naturally say it. May equal the correction.'),
  feedback: z.string().describe('One short, warm, encouraging sentence about their answer.'),
  reply: z.string().describe('A short natural conversational reaction to what they said (not about grammar).'),
  nextQuestion: z.string().describe('One follow-up question that continues the conversation.'),
  estimatedLevel: EnglishLevelSchema.nullable().catch(null).describe('CEFR level this response most closely demonstrates.'),
});
export type EnglishAnalysis = z.infer<typeof EnglishAnalysisSchema>;

export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface TutorContext {
  level: EnglishLevel;
  topic: string;
  /** Mistake category the learner wants to practice, if any. */
  focus?: MistakeCategory;
}

export interface PronunciationResult {
  /** 0-100. */
  score: number;
  label: string;
  wordsToPractice: string[];
  /** Which analyzer produced the score, so the UI can explain what it measures. */
  source: string;
}
