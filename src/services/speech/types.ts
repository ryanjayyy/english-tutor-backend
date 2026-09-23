export interface TranscribedWord {
  word: string;
  /** Recognizer confidence, 0-1. */
  confidence: number;
  start: number;
  end: number;
}

export interface Transcription {
  text: string;
  durationSeconds: number;
  words: TranscribedWord[];
}

export interface AudioInput {
  data: Buffer;
  mimeType: string;
}

/** Provider-agnostic speech-to-text. Replace the implementation to switch vendors. */
export interface SpeechToTextService {
  transcribe(audio: AudioInput): Promise<Transcription>;
}
