import type { Provider } from '../../src/shared/settings/settings.model';
import { providerCli } from '../../src/shared/workspace/terminal-name';

/** What each Provider's CLI is called on the user's PATH. Timmy does not install it (see the glossary). */
export const providerCommand = (provider: Provider): string => providerCli[provider];
