import { Option, Schema } from 'effect';
import { AttachmentMediaType } from '../../src/shared/attachments/attachment.model';
import { HistoryImage, HistoryItem } from '../../src/shared/sessions/sessions.model';
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

const ClaudeImageBlock = Schema.Struct({
  type: Schema.Literal('image'),
  source: Schema.Struct({ type: Schema.Literal('base64'), media_type: AttachmentMediaType, data: Schema.String }),
});

const decodeImage = Schema.decodeUnknownOption(ClaudeImageBlock);
const isImageBlock = (raw: unknown): boolean => typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'image';

/** An image block that does not decode (a URL source, an unknown type) is a placeholder, never a failure. */
const imageOf = (raw: unknown): HistoryImage => {
  const block = decodeImage(raw);
  return Option.isSome(block)
    ? { _tag: 'Image', mediaType: block.value.source.media_type, data: block.value.source.data }
    : { _tag: 'Missing' };
};

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
  const images = role === 'User' ? message.content.filter(isImageBlock).map(imageOf) : [];
  let pending = images;
  // The images belong to the first message of the entry; an image-only entry gets an empty text.
  const withImages = (text: string): HistoryItem => {
    const own = pending;
    pending = [];
    return { _tag: 'Message', role, text, ...(own.length > 0 ? { images: own } : {}), ...stamp };
  };
  const items = message.content.flatMap((raw): ReadonlyArray<HistoryItem> => {
    const block = decodeBlock(raw);
    if (Option.isNone(block)) return [];
    return block.value.type === 'text'
      ? [withImages(block.value.text)]
      : [{ _tag: 'ToolCall', toolName: block.value.name, input: JSON.stringify(block.value.input), ...stamp }];
  });
  return pending.length > 0 ? [withImages(''), ...items] : items;
};

/**
 * Claude's native transcript as conversation lines. Only user and assistant text and tool calls
 * are kept; injected reminders and task notifications, tool results, titles, modes and other bookkeeping entries are not part of the history.
 */
export const claudeHistory = (entries: ReadonlyArray<TranscriptEntry>): ReadonlyArray<HistoryItem> =>
  entries.flatMap(itemsOf);
