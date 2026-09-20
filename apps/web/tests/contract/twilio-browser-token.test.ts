import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { twilioTelephony } from '@/lib/adapters/telephony/twilio';

/**
 * The credential a browser holds to be a telephone, checked offline.
 *
 * `browserTelephoneToken` is a boundary CLAUDE.md names and no test referenced it. The adapter
 * mints a JWT itself, so its shape is fully checkable without the carrier: it must carry exactly
 * one identity and one application, expire, verify under the API key secret, and contain neither
 * that secret nor the account's auth token. Nothing is called; no `fetch` is involved.
 */

const CONFIG = {
  account: 'ACcontractsuite',
  token: 'the-account-auth-token-must-never-appear',
  apiKeySid: 'SKcontractsuite',
  apiKeySecret: 'the-api-key-secret-signs-but-never-appears',
  appSid: 'APcontractsuite',
};

const provider = twilioTelephony(CONFIG);

type Claims = {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  grants: { identity: string; voice: { outgoing: { application_sid: string } } };
};
const decode = (segment: string) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Claims;

describe('the browser telephone credential', () => {
  it('is a three-part token in the carrier’s access-token format', async () => {
    const token = await provider.browserToken({ identity: 'user-1' });
    const [header] = token.split('.');

    expect(token.split('.')).toHaveLength(3);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toEqual({ alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' });
  });

  it('names one person, one application and one account, and nothing wider', async () => {
    const [, payload] = (await provider.browserToken({ identity: 'user-1' })).split('.');
    const claims = decode(payload);

    expect(claims.iss).toBe(CONFIG.apiKeySid);
    expect(claims.sub).toBe(CONFIG.account);
    expect(claims.grants.identity).toBe('user-1');
    expect(claims.grants.voice.outgoing).toEqual({ application_sid: CONFIG.appSid });
    expect(Object.keys(claims.grants).sort()).toEqual(['identity', 'voice']);
  });

  it('expires after an hour by default, and after the time it is asked for', async () => {
    const [, defaultPayload] = (await provider.browserToken({ identity: 'u' })).split('.');
    const [, shortPayload] = (await provider.browserToken({ identity: 'u', ttlSeconds: 60 })).split('.');

    expect(decode(defaultPayload).exp - decode(defaultPayload).iat).toBe(3600);
    expect(decode(shortPayload).exp - decode(shortPayload).iat).toBe(60);
  });

  it('is signed with the API key secret, so only this server could have made it', async () => {
    const [header, payload, signature] = (await provider.browserToken({ identity: 'user-1' })).split('.');
    const expected = createHmac('sha256', CONFIG.apiKeySecret).update(`${header}.${payload}`).digest('base64url');
    const wrong = createHmac('sha256', CONFIG.token).update(`${header}.${payload}`).digest('base64url');

    expect(signature).toBe(expected);
    expect(signature).not.toBe(wrong);
  });

  it('carries neither secret, and is different every time it is minted', async () => {
    const first = await provider.browserToken({ identity: 'user-1' });
    const second = await provider.browserToken({ identity: 'user-1' });
    const readable = first.split('.').slice(0, 2).map((part) => Buffer.from(part, 'base64url').toString('utf8')).join('');

    expect(readable).not.toContain(CONFIG.token);
    expect(readable).not.toContain(CONFIG.apiKeySecret);
    expect(first).not.toContain(CONFIG.apiKeySecret);
    expect(decode(first.split('.')[1]).jti).not.toBe(decode(second.split('.')[1]).jti);
  });
});
