import type { SlashCommand } from '../../../shared/chat/command.model';

/** Loading, failure and empty stay distinct so the popup never shows a failure as "no commands". */
export type CommandsState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'ready'; readonly items: ReadonlyArray<SlashCommand> };

/**
 * The text typed after a leading `/`, while the caret is still inside that first word.
 * Commands only run at the start of a message, so anything else is not a command query.
 */
export const slashQuery = (text: string, caret: number): string | undefined =>
  /^\/(\S*)$/.exec(text.slice(0, caret))?.[1];

/** Commands whose name starts with the query first, then those that merely contain it. */
export const filterCommands = (
  commands: ReadonlyArray<SlashCommand>,
  query: string,
): ReadonlyArray<SlashCommand> => {
  const needle = query.toLowerCase();
  const prefix: SlashCommand[] = [];
  const inside: SlashCommand[] = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    if (name.startsWith(needle)) prefix.push(command);
    else if (name.includes(needle)) inside.push(command);
  }
  return [...prefix, ...inside];
};

/** Replaces the typed `/query` with `/name ` and puts the caret after it. */
export const applyCommand = (text: string, caret: number, command: SlashCommand) => {
  const rest = text.slice(caret).replace(/^ /, '');
  const head = `/${command.name} `;
  return { text: head + rest, caret: head.length };
};
