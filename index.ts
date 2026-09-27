/**
 * Berget AI Auth Plugin for OpenCode
 *
 * Authenticate OpenCode with your Berget AI account to use
 * AI models through Berget's European AI infrastructure.
 *
 * @example
 * ```json
 * // opencode.json
 * {
 *   "$schema": "https://opencode.ai/config.json",
 *   "plugin": ["@bergetai/opencode-auth@latest"]
 * }
 * ```
 *
 * @see https://berget.ai
 * @see https://opencode.ai/docs/plugins
 */

import { BergetAuthPlugin } from './src/plugin';
import { BergetV2Plugin } from './src/v2';

// One default export for both runtimes: OpenCode V2 reads id + setup,
// OpenCode V1 reads server() (loader verified 1.3.13 through 1.18.32)
export default { ...BergetV2Plugin, server: BergetAuthPlugin };

// Also export as PluginModule format for compatibility
export { BergetAuthPlugin as server } from './src/plugin';

// Named exports for backward compatibility
export { BergetAuthPlugin, BergetOAuthPlugin } from './src/plugin';

// Re-export utilities that might be useful
export { accessTokenExpired, isOAuthAuth } from './src/plugin/auth';

export { createPkceAuthorizeMethod } from './src/plugin/pkce-flow';

// Re-export types for consumers
export type {
  AuthDetails,
  AuthOAuthResult,
  BergetUser,
  OAuthAuthDetails,
} from './src/plugin/types';
export { BergetV2Plugin } from './src/v2';
