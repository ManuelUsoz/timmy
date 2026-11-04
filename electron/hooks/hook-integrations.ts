import os from 'node:os';
import path from 'node:path';
import { Context, Layer, Option } from 'effect';
import type { Provider } from '../../src/shared/settings/settings.model';
import { makeClaudeCodeHook } from './claude-code-hook';
import type { HookIntegration } from './hook-integration';

/**
 * Every Provider that has a Hook, one `HookIntegration` each. This is the only place that lists them: a Provider
 * gets a Hook by adding its Integration here.
 */
export class HookIntegrations extends Context.Service<HookIntegrations, {
  readonly all: ReadonlyArray<HookIntegration>;
  readonly get: (provider: Provider) => Option.Option<HookIntegration>;
}>()('hooks/HookIntegrations') {}

const make = (all: ReadonlyArray<HookIntegration>): typeof HookIntegrations.Service => ({
  all,
  get: (provider) => Option.fromNullishOr(all.find((integration) => integration.provider === provider)),
});

/** Claude Code reads its user settings from `$CLAUDE_CONFIG_DIR`, or `~/.claude` when that is not set. */
export const claudeSettingsFile = (configDir: string | undefined = process.env['CLAUDE_CONFIG_DIR']): string =>
  path.join(configDir === undefined || configDir === '' ? path.join(os.homedir(), '.claude') : configDir, 'settings.json');

/** `claudeSettings` is where Claude Code's user settings live; tests and the e2e app point it somewhere safe. */
export const layerHookIntegrations = (claudeSettings: string = claudeSettingsFile()): Layer.Layer<HookIntegrations> =>
  Layer.succeed(HookIntegrations, make([makeClaudeCodeHook(claudeSettings)]));

export const layerHookIntegrationsTest = (all: ReadonlyArray<HookIntegration>): Layer.Layer<HookIntegrations> =>
  Layer.succeed(HookIntegrations, make(all));
