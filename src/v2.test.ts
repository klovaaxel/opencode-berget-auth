import type { Credential, Plugin } from '@opencode/plugin';
import type { IntegrationMethodRegistration } from '@opencode/plugin/promise/integration';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthorizeResult } from './plugin/types';

import pluginDefault from '../index';
import { BergetAuthPlugin } from './plugin';
import {
  BERGET_V2_PLUGIN_ID,
  BergetV2Plugin,
  BROWSER_METHOD_ID,
  DEVICE_METHOD_ID,
  oauthMethod,
  refreshCredential,
  toCredential,
} from './v2';

vi.mock('./plugin/pkce-flow', () => ({ createPkceAuthorizeMethod: () => vi.fn() }));
vi.mock('./plugin/device-flow', () => ({ createDeviceAuthorizeMethod: () => vi.fn() }));

const credential = {
  access: 'old-access',
  expires: 1000,
  metadata: { account: 'seat' },
  methodID: BROWSER_METHOD_ID,
  refresh: 'old-refresh',
  type: 'oauth',
} as unknown as Credential.OAuth;

function flow(callback: AuthorizeResult['callback']): AuthorizeResult {
  return { callback, instructions: 'Sign in', method: 'auto', url: 'https://auth.berget.ai/x' };
}

describe('toCredential', () => {
  it('maps a successful OAuth result to a V2 credential', () => {
    const result = toCredential(DEVICE_METHOD_ID, {
      access: 'a',
      expires: 42,
      refresh: 'r',
      type: 'success',
    });

    expect(result).toEqual({
      access: 'a',
      expires: 42,
      methodID: DEVICE_METHOD_ID,
      refresh: 'r',
      type: 'oauth',
    });
  });

  it('throws the flow error on failure', () => {
    expect(() => toCredential(BROWSER_METHOD_ID, { error: 'denied', type: 'failed' })).toThrow(
      'denied',
    );
  });

  it('rejects an API key result', () => {
    expect(() => toCredential(BROWSER_METHOD_ID, { key: 'k', type: 'success' })).toThrow('API key');
  });
});

describe('refreshCredential', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns refreshed tokens and keeps method ID and metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ expires_in: 3600, refresh_token: 'new-refresh', token: 'new-access' }),
        ok: true,
      }),
    );

    const result = await refreshCredential(credential);

    expect(result.access).toBe('new-access');
    expect(result.refresh).toBe('new-refresh');
    expect(result.expires).toBeGreaterThan(Date.now());
    expect(result.methodID).toBe(BROWSER_METHOD_ID);
    expect(result.metadata).toEqual({ account: 'seat' });
  });

  it('throws when the refresh endpoint rejects the token', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: 'invalid_grant' }),
      }),
    );

    await expect(refreshCredential(credential)).rejects.toThrow('invalid or revoked');
  });
});

describe('oauthMethod', () => {
  it('adapts a V1 authorize flow to a V2 auto authorization', async () => {
    const method = oauthMethod(BROWSER_METHOD_ID, 'Browser', async () =>
      flow(async () => ({ access: 'a', expires: 1, refresh: 'r', type: 'success' as const })),
    );

    expect(method.integrationID).toBe('berget');
    expect(method.method).toEqual({ id: BROWSER_METHOD_ID, label: 'Browser', type: 'oauth' });
    expect(method.refresh).toBe(refreshCredential);

    const authorization = await method.authorize({});
    expect(authorization.mode).toBe('auto');
    expect(authorization.url).toBe('https://auth.berget.ai/x');
    expect(authorization.instructions).toBe('Sign in');
    if (authorization.mode !== 'auto') throw new Error('expected auto mode');
    await expect(authorization.callback).resolves.toMatchObject({
      access: 'a',
      methodID: BROWSER_METHOD_ID,
    });
  });

  it('rejects the callback when the flow fails', async () => {
    const method = oauthMethod(DEVICE_METHOD_ID, 'Device', async () =>
      flow(async () => ({ error: 'Device code expired', type: 'failed' as const })),
    );

    const authorization = await method.authorize({});
    if (authorization.mode !== 'auto') throw new Error('expected auto mode');
    await expect(authorization.callback).rejects.toThrow('Device code expired');
  });
});

describe('BergetV2Plugin setup', () => {
  it('registers both seat methods and points the provider at the inference URL', async () => {
    const registrations: IntegrationMethodRegistration[] = [];
    const provider: { settings?: Record<string, unknown> } = { settings: { timeout: 5 } };
    const context = {
      integration: {
        transform: async (callback: (editor: unknown) => void) => {
          callback({
            method: { update: (input: IntegrationMethodRegistration) => registrations.push(input) },
          });
        },
      },
      provider: {
        transform: async (callback: (editor: unknown) => void) => {
          callback({
            get: (id: string) => (id === 'berget' ? {} : undefined),
            update: (_id: string, update: (p: typeof provider) => void) => update(provider),
          });
        },
      },
    } as unknown as Plugin.Context;

    await BergetV2Plugin.setup(context);

    expect(registrations.map((r) => 'id' in r.method && r.method.id)).toEqual([
      BROWSER_METHOD_ID,
      DEVICE_METHOD_ID,
    ]);
    expect(provider.settings).toEqual({ baseURL: 'https://api.berget.ai/v1', timeout: 5 });
  });
});

describe('default export', () => {
  it('serves V2 (id + setup) and V1 (server) from one object', () => {
    expect(pluginDefault.id).toBe(BERGET_V2_PLUGIN_ID);
    expect(pluginDefault.setup).toBe(BergetV2Plugin.setup);
    expect(pluginDefault.server).toBe(BergetAuthPlugin);
  });
});
