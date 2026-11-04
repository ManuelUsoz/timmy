import type { Provider } from '../../src/shared/settings/settings.model';

/** What each Provider's CLI is called on the user's PATH. Timmy does not install it (see the glossary). */
const commands: Readonly<Record<Provider, string>> = {
  OpenCode: 'opencode',
  ClaudeCode: 'claude',
  Codex: 'codex',
};

export const providerCommand = (provider: Provider): string => commands[provider];
