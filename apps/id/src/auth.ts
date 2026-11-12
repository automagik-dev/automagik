import { betterAuth } from 'better-auth';
import { jwt, phoneNumber } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { oauthProvider } from '@better-auth/oauth-provider';

function strictRedirectUri(uri: string, registered: readonly string[], defaultResult: boolean) {
  const url = new URL(uri);
  // RFC 8252's changing-port exception is for IP literals, never a DNS name.
  if (url.protocol === 'http:' && url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') {
    return defaultResult && registered.includes(uri);
  }
  return defaultResult;
}

export interface Env {
  DB: D1Database;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  OMNI_OTP_URL?: string;
  OMNI_API_TOKEN?: string;
  PAGES?: Fetcher;
}

// Always include phone fields in migrations; installing its routes remains conditional.
export function createAuth(env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>, schemaOnly = false) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be provisioned');
  }
  const origin = new URL(env.BETTER_AUTH_URL).origin;
  return betterAuth({
    appName: 'Automagik ID',
    baseURL: origin,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    emailAndPassword: { enabled: false },
    socialProviders: {},
    session: { cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60 },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      backgroundTasks: { handler: promise => ctx.waitUntil(promise) },
    },
    plugins: [
      passkey({
        rpID: new URL(origin).hostname,
        rpName: 'Automagik ID',
        origin,
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        registration: {
          requireSession: false,
          async resolveUser({ ctx: endpoint }) {
            const user = await endpoint.context.internalAdapter.createUser({
              name: 'Automagik user',
              email: `${crypto.randomUUID()}@id.invalid`,
              emailVerified: false,
            }, { method: 'passkey' });
            return { id: user.id, name: 'Automagik user', displayName: 'Automagik user' };
          },
        },
      }),
      jwt({ disableSettingJwtHeader: true }),
      oauthProvider({
        loginPage: '/sign-in',
        consentPage: '/consent',
        scopes: ['openid', 'profile', 'offline_access'],
        grantTypes: ['authorization_code', 'refresh_token'],
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        allowPublicClientPrelogin: true,
        clientPrivileges: async () => false,
        clientRegistrationRequirePKCE: true,
        validateRedirectUri: strictRedirectUri,
      }),
      ...(env.OMNI_OTP_URL || schemaOnly ? [phoneNumber({
        allowedAttempts: 3,
        requireVerification: true,
        phoneNumberValidator: number => /^\+[1-9]\d{7,14}$/.test(number),
        sendOTP({ phoneNumber, code }) {
          if (!env.OMNI_OTP_URL) return;
          const url = new URL(env.OMNI_OTP_URL);
          if (url.protocol !== 'https:') throw new Error('Omni requires HTTPS');
          ctx.waitUntil(fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(env.OMNI_API_TOKEN ? { authorization: `Bearer ${env.OMNI_API_TOKEN}` } : {}),
            },
            body: JSON.stringify({ phoneNumber, code }),
          }).then(response => {
            if (!response.ok) throw new Error('Omni delivery failed');
          }).catch(() => { console.error('Omni OTP delivery failed'); }));
        },
        signUpOnVerification: {
          getTempEmail: () => `${crypto.randomUUID()}@id.invalid`,
          getTempName: () => 'Automagik user',
        },
      })] : []),
    ],
  });
}
