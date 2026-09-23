import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

import {
  EnglishAnalysisSchema,
  type ConversationTurn,
  type EnglishAnalysis,
  type PracticeMode,
  type TutorContext,
} from '../../domain/types.js';
import { AppError, timeout, upstream } from '../../lib/errors.js';
import {
  MAX_HISTORY_TURNS,
  TUTOR_SYSTEM_PROMPT,
  buildAnalysisRequest,
  buildOpeningRequest,
  describeContext,
} from './prompt.js';
import type { EnglishTutorService, OpeningMessage } from './types.js';

const OpeningSchema = z.object({
  message: z.string().describe('A brief greeting followed by the first question.'),
});

interface ClaudeTutorOptions {
  apiKey: string;
  model: string;
}

export class ClaudeEnglishTutor implements EnglishTutorService {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor({ apiKey, model }: ClaudeTutorOptions) {
    // Conversation turns are interactive: fail within a minute rather than leave the learner waiting.
    this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
    this.model = model;
  }

  startConversation(context: TutorContext): Promise<OpeningMessage> {
    return this.request(OpeningSchema, context, buildOpeningRequest());
  }

  analyzeResponse(
    userMessage: string,
    conversationHistory: ConversationTurn[],
    context: TutorContext & { mode: PracticeMode },
  ): Promise<EnglishAnalysis> {
    const history = conversationHistory.slice(-MAX_HISTORY_TURNS);
    return this.request(EnglishAnalysisSchema, context, buildAnalysisRequest(userMessage, history, context.mode));
  }

  private async request<T extends z.ZodType>(schema: T, context: TutorContext, content: string): Promise<z.infer<T>> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 4000,
        // Conversation turns are routine work; low effort keeps replies quick.
        output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
        // If the model declines, the API retries on its recommended fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [
          { type: 'text', text: TUTOR_SYSTEM_PROMPT },
          { type: 'text', text: describeContext(context) },
        ],
        messages: [{ role: 'user', content }],
      });

      if (response.stop_reason === 'refusal') {
        throw upstream('The tutor could not respond to that message. Please try saying it differently.', 'AI_REFUSAL');
      }
      if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
        throw upstream('The tutor returned an incomplete answer. Please try again.', 'AI_BAD_RESPONSE');
      }
      return response.parsed_output as z.infer<T>;
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }
}

function mapAnthropicError(error: unknown): Error {
  if (error instanceof AppError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return timeout('The tutor took too long to answer. Please try again.', 'AI_TIMEOUT', error);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AppError(503, 'AI_BUSY', 'The tutor is busy right now. Please try again in a moment.', { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return upstream('Could not reach the tutor service. Please try again.', 'AI_UNREACHABLE', error);
  }
  if (error instanceof Anthropic.APIError) {
    return upstream('The tutor service had a problem. Please try again.', 'AI_ERROR', error);
  }
  if (error instanceof z.ZodError) {
    return upstream('The tutor returned an unexpected answer. Please try again.', 'AI_BAD_RESPONSE', error);
  }
  return error instanceof Error ? error : new Error(String(error));
}
