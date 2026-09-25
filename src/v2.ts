/**
 * OpenCode V2 entrypoint for the Berget Auth Plugin
 *
 * V2 owns credential storage and refresh: the plugin registers its OAuth
 * methods on the built-in "berget" integration and hands V2 a refresh
 * function, and V2 applies the stored access token to Berget requests.
 * The PKCE and device flows are shared with the V1 plugin unchanged.
 */

import type { Credential, Plugin } from '@opencode/plugin';
import type { IntegrationOAuthMethodRegistration } from '@opencode/plugin/promise/integration';

import type { AuthOAuthResult, AuthorizeResult } from './plugin/types';

import { BERGET_PROVIDER_ID, getInferenceUrl } from './constants';
import { logDebug } from './plugin/debug';
import { createDeviceAuthorizeMethod } from './plugin/device-flow';
import { createPkceAuthorizeMethod } from './plugin/pkce-flow';
import { refreshAccessTokenDirect } from './plugin/token';

export const BERGET_V2_PLUGIN_ID = 'bergetai.opencode-auth';

// Stable method IDs: a stored credential is refreshed by the method whose ID it carries
export const BROWSER_METHOD_ID = 'berget-code-browser';
export const DEVICE_METHOD_ID = 'berget-code-device';

type MethodID = Credential.OAuth['methodID'];

/**
 * Wraps a V1 authorize method as a V2 OAuth method registration
 */
export function oauthMethod(
  id: string,
  label: string,
  authorize: () => Promise<AuthorizeResult>,
): IntegrationOAuthMethodRegistration {
  return {
    authorize: async () => {
      const flow = await authorize();
      const callback = (async () => toCredential(id, await flow.callback('')))();
      // V2 awaits the callback; this only stops a cancelled attempt surfacing as unhandled
      callback.catch(() => {});
      return {
        callback,
        instructions: flow.instructions,
        mode: 'auto',
        url: flow.url,
      };
    },
    integrationID: BERGET_PROVIDER_ID,
    method: { id, label, type: 'oauth' },
    refresh: refreshCredential,
  };
}

/**
 * Refreshes a V2 OAuth credential, keeping its method ID and metadata
 */
export async function refreshCredential(credential: Credential.OAuth): Promise<Credential.OAuth> {
  const result = await refreshAccessTokenDirect({
    access: credential.access,
    expires: credential.expires,
    refresh: credential.refresh,
    type: 'oauth',
  });
  if (!result.success) {
    throw new Error(`Berget token refresh failed: ${result.reason}`);
  }
  return {
    ...credential,
    access: result.auth.access ?? '',
    expires: result.auth.expires ?? 0,
    refresh: result.auth.refresh,
  };
}

/**
 * Converts a V1 flow result into a V2 OAuth credential, throwing on failure
 */
export function toCredential(methodID: string, result: AuthOAuthResult): Credential.OAuth {
  if (result.type === 'failed') {
    throw new Error(result.error ?? 'Berget sign-in failed');
  }
  if (!('access' in result)) {
    throw new Error('Berget sign-in returned an API key instead of an OAuth token');
  }
  return {
    access: result.access,
    expires: result.expires,
    methodID: methodID as MethodID,
    refresh: result.refresh,
    type: 'oauth',
  };
}

export const BergetV2Plugin: Plugin.Plugin = {
  id: BERGET_V2_PLUGIN_ID,
  async setup(context) {
    logDebug('Initializing Berget Auth Plugin (OpenCode V2)');

    const browser = createPkceAuthorizeMethod();
    const device = createDeviceAuthorizeMethod();
    await context.integration.transform((editor) => {
      editor.method.update(
        oauthMethod(BROWSER_METHOD_ID, 'Berget Code Seat - Login using this device', () =>
          browser(),
        ),
      );
      editor.method.update(
        oauthMethod(DEVICE_METHOD_ID, 'Berget Code Seat - Login using other device with QR', () =>
          device(),
        ),
      );
    });

    // Honour BERGET_INFERENCE_URL like the V1 plugin; V2's catalog supplies the models
    await context.provider.transform((editor) => {
      if (!editor.get(BERGET_PROVIDER_ID)) return;
      editor.update(BERGET_PROVIDER_ID, (provider) => {
        provider.settings = { ...provider.settings, baseURL: getInferenceUrl() };
      });
    });
  },
};
