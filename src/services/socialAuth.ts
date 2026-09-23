import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import { unauthorized } from '../lib/errors.js';

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export interface SocialIdentity {
  subject: string;
  email: string | null;
  name: string | null;
}

export interface SocialTokenVerifier {
  verifyApple(identityToken: string): Promise<SocialIdentity>;
  verifyGoogle(idToken: string): Promise<SocialIdentity>;
}

export class JwksSocialTokenVerifier implements SocialTokenVerifier {
  constructor(private readonly config: { appleAudiences: string[]; googleClientIds: string[] }) {}

  async verifyApple(identityToken: string): Promise<SocialIdentity> {
    if (this.config.appleAudiences.length === 0) {
      throw unauthorized('Sign in with Apple is not configured on the server.', 'APPLE_NOT_CONFIGURED');
    }
    const payload = await verify(identityToken, appleKeys, {
      issuer: 'https://appleid.apple.com',
      audience: this.config.appleAudiences,
    });
    return { subject: payload.sub!, email: emailFrom(payload), name: null };
  }

  async verifyGoogle(idToken: string): Promise<SocialIdentity> {
    if (this.config.googleClientIds.length === 0) {
      throw unauthorized('Google Sign-In is not configured on the server.', 'GOOGLE_NOT_CONFIGURED');
    }
    const payload = await verify(idToken, googleKeys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: this.config.googleClientIds,
    });
    return {
      subject: payload.sub!,
      email: emailFrom(payload),
      name: typeof payload.name === 'string' ? payload.name : null,
    };
  }
}

async function verify(
  token: string,
  keys: ReturnType<typeof createRemoteJWKSet>,
  options: { issuer: string | string[]; audience: string[] },
): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, keys, options);
    if (!payload.sub) throw new Error('missing subject');
    return payload;
  } catch {
    throw unauthorized('Sign-in could not be verified. Please try again.', 'INVALID_SOCIAL_TOKEN');
  }
}

/** Only trust emails the identity provider has verified. */
function emailFrom(payload: JWTPayload): string | null {
  const verified = payload.email_verified === true || payload.email_verified === 'true';
  return verified && typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
}
