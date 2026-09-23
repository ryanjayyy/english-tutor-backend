import type { Db } from './db.js';
import type { PronunciationAnalyzer } from './services/pronunciation/types.js';
import type { SocialTokenVerifier } from './services/socialAuth.js';
import type { SpeechToTextService } from './services/speech/types.js';
import type { EnglishTutorService } from './services/tutor/types.js';

/** Everything routes depend on, injected so providers can be swapped (and faked in tests). */
export interface AppServices {
  db: Db;
  tutor: EnglishTutorService;
  speech: SpeechToTextService;
  pronunciation: PronunciationAnalyzer;
  social: SocialTokenVerifier;
}
