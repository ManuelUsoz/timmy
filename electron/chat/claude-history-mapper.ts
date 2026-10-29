import { Option, Schema } from 'effect';
import { HistoryItem } from '../../src/shared/sessions/sessions.model';
import { TranscriptEntry } from '../sessions/session-repo';

const ClaudeEntry = Schema.Struct({
  type: Schema.Literals(['user', 'assistant']),
  isMeta: Schema.optionalKey(Schema.Boolean),
  /** Set on user entries the harness injected (task notifications); real prompts have none. */
  origin: Schema.optionalKey(Schema.Unknown),
  message: Schema.Struct({ content: Schema.Union([Schema.String, Schema.Array(Schema.Unknown)]) }),
});

const ClaudeBlock = Schema.Union([
  Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('tool_use'), name: Schema.String, input: Schema.Unknown }),
]);

const decodeEntry = Schema.decodeUnknownOption(ClaudeEntry);
const decodeBlock = Schema.decodeUnknownOption(ClaudeBlock);

const itemsOf = (entry: TranscriptEntry): ReadonlyArray<HistoryItem> => {
  const decoded = decodeEntry(entry.native);
  if (Option.isNone(decoded)) return [];
  const { type, message, isMeta, origin } = decoded.value;
  if (isMeta === true || origin !== undefined) return [];
  const role = type === 'user' ? 'User' : 'Assistant';
  const stamp = entry.timestamp === undefined ? {} : { timestamp: entry.timestamp };
  if (typeof message.content === 'string') return [{ _tag: 'Message', role, text: message.content, ...stamp }];
  return message.content.flatMap((raw): ReadonlyArray<HistoryItem> => {
    const block = decodeBlock(raw);
    if (Option.isNone(block)) return [];
    return block.value.type === 'text'
      ? [{ _tag: 'Message', role, text: block.value.text, ...stamp }]
      : [{ _tag: 'ToolCall', toolName: block.value.name, input: JSON.stringify(block.value.input), ...stamp }];
  });
};

/**
 * Claude's native transcript as conversation lines. Only user and assistant text and tool calls
 * are kept; injected reminders and task notifications, tool results, titles, modes and other bookkeeping entries are not part of the history.
 */
export const claudeHistory = (entries: ReadonlyArray<TranscriptEntry>): ReadonlyArray<HistoryItem> =>
  entries.flatMap(itemsOf);
