import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Effect, Option } from 'effect';
import { HooksError } from '../../src/shared/hooks/hooks-error.model';
import { HookConstants, type HookSignal } from '../../src/shared/hooks/hooks.model';
import type { HookIntegration } from './hook-integration';

/** The events whose Hook entry Timmy owns. Each posts the same payload; `decode` tells them apart. */
const EVENTS = ['UserPromptSubmit', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'] as const;

const { terminalIdEnv, urlEnv, marker: MARKER } = HookConstants;

/**
 * Outside a Terminal Timmy started the terminal id is empty and this does nothing. Inside one it posts the event
 * (JSON on stdin) to the local channel, and whatever happens it exits 0 so Claude Code never shows a hook error.
 */
const COMMAND = `[ -z "$${terminalIdEnv}" ] || curl -s -m 2 -X POST -H 'Content-Type: application/json' --data-binary @- "$${urlEnv}/ClaudeCode" >/dev/null 2>&1; exit 0 ${MARKER}`;

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

const isOurs = (handler: unknown): boolean => isRecord(handler) && typeof handler['command'] === 'string' && handler['command'].includes(MARKER);

const handlersOf = (group: unknown): ReadonlyArray<unknown> => (isRecord(group) && Array.isArray(group['hooks']) ? group['hooks'] : []);

const hasOurs = (config: Json): boolean => {
  const hooks = config['hooks'];
  return isRecord(hooks) && EVENTS.some((event) => Array.isArray(hooks[event]) && hooks[event].some((group) => handlersOf(group).some(isOurs)));
};

/** The config without Timmy's entries; groups, events and the `hooks` key Timmy's removal emptied go too. */
const withoutOurs = (config: Json): Json => {
  const hooks = config['hooks'];
  if (!isRecord(hooks)) return config;
  const kept: Json = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      kept[event] = groups;
      continue;
    }
    const nextGroups = groups.flatMap((group): ReadonlyArray<unknown> => {
      const handlers = handlersOf(group);
      if (!handlers.some(isOurs)) return [group];
      const remaining = handlers.filter((handler) => !isOurs(handler));
      return remaining.length === 0 ? [] : [{ ...(group as Json), hooks: remaining }];
    });
    if (nextGroups.length > 0 || groups.length === 0) kept[event] = nextGroups;
  }
  const { hooks: _removed, ...rest } = config;
  return Object.keys(kept).length === 0 ? rest : { ...rest, hooks: kept };
};

/** Why Timmy cannot add its entries to this config without replacing something of the user's. */
const blocker = (config: Json): string | undefined => {
  const hooks = config['hooks'];
  if (hooks === undefined) return undefined;
  if (!isRecord(hooks)) return '"hooks" is not an object';
  const event = EVENTS.find((name) => hooks[name] !== undefined && !Array.isArray(hooks[name]));
  return event === undefined ? undefined : `"hooks.${event}" is not a list`;
};

const withOurs = (config: Json): Json => {
  const clean = withoutOurs(config);
  const hooks = isRecord(clean['hooks']) ? clean['hooks'] : {};
  const added: Json = { ...hooks };
  for (const event of EVENTS) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    added[event] = [...existing, { hooks: [{ type: 'command', command: COMMAND, timeout: 5 }] }];
  }
  return { ...clean, hooks: added };
};

const signalOf = (payload: Json): Option.Option<HookSignal> => {
  switch (payload['hook_event_name']) {
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return Option.some('Working');
    case 'Stop':
      return Option.some('Done');
    case 'SessionEnd':
      return Option.some('Ended');
    case 'Notification':
      switch (payload['notification_type']) {
        case 'permission_prompt':
        case 'elicitation_dialog':
          return Option.some('Waiting');
        case 'idle_prompt':
          return Option.some('Done');
        default:
          return Option.none();
      }
    default:
      return Option.none();
  }
};

/** Claude Code's Hook, written into `settingsFile` (Claude Code's user settings). */
export const makeClaudeCodeHook = (settingsFile: string): HookIntegration => {
  const unreadable = (detail: string) => new HooksError({ reason: 'ConfigUnreadable', detail });

  /** `None` when there is no file yet. A file that is not a JSON object is never rewritten. */
  const read: Effect.Effect<Option.Option<Json>, HooksError> = Effect.tryPromise({
    try: () => readFile(settingsFile, 'utf8'),
    catch: (error) => error,
  }).pipe(
    Effect.map((text) => ({ missing: false, text })),
    Effect.catch((error) =>
      (error as NodeJS.ErrnoException).code === 'ENOENT' ? Effect.succeed({ missing: true, text: '' }) : Effect.fail(unreadable(`${settingsFile} cannot be read`)),
    ),
    Effect.flatMap(({ missing, text }) =>
      missing
        ? Effect.succeed(Option.none<Json>())
        : Effect.try({ try: (): unknown => JSON.parse(text), catch: () => unreadable(`${settingsFile} is not valid JSON`) }).pipe(
            Effect.flatMap((json) => (isRecord(json) ? Effect.succeed(Option.some(json)) : Effect.fail(unreadable(`${settingsFile} is not a JSON object`)))),
          ),
    ),
  );

  /** Written next to the target and renamed over it, so a crash never leaves half a file. */
  const write = (config: Json): Effect.Effect<void> =>
    Effect.tryPromise(async () => {
      await mkdir(path.dirname(settingsFile), { recursive: true });
      const partial = `${settingsFile}.timmy.tmp`;
      await writeFile(partial, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      await rename(partial, settingsFile);
    }).pipe(Effect.orDie);

  return {
    provider: 'ClaudeCode',
    isActive: read.pipe(Effect.map(Option.exists(hasOurs))),
    activate: read.pipe(
      Effect.flatMap((config) => {
        const current = Option.getOrElse(config, (): Json => ({}));
        const problem = blocker(current);
        return problem === undefined ? write(withOurs(current)) : Effect.fail(unreadable(`${settingsFile}: ${problem}`));
      }),
    ),
    deactivate: read.pipe(
      Effect.flatMap((config) => (Option.isSome(config) && hasOurs(config.value) ? write(withoutOurs(config.value)) : Effect.void)),
    ),
    decode: (payload) => (isRecord(payload) ? signalOf(payload) : Option.none()),
  };
};
