import { Schema } from 'effect';

/** A slash command the provider offers: built-in, or defined by the user, project, plugin or MCP server. */
export const SlashCommand = Schema.Struct({
  /** Without the leading slash. */
  name: Schema.String,
  description: Schema.String,
  /** Hint for the arguments, e.g. `<file>`; empty when the command takes none. */
  argumentHint: Schema.String,
}).annotate({ identifier: 'SlashCommand' });
export type SlashCommand = typeof SlashCommand.Type;
