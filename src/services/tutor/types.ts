import type { ConversationTurn, EnglishAnalysis, PracticeMode, TutorContext } from '../../domain/types.js';

export interface OpeningMessage {
  /** Friendly opener that ends with the first question. */
  message: string;
}

/**
 * Provider-agnostic tutor. Swap the implementation (a different model or vendor)
 * without touching routes or the mobile app.
 */
export interface EnglishTutorService {
  startConversation(context: TutorContext): Promise<OpeningMessage>;
  analyzeResponse(
    userMessage: string,
    conversationHistory: ConversationTurn[],
    context: TutorContext & { mode: PracticeMode },
  ): Promise<EnglishAnalysis>;
}
