import { describe, expect, it } from 'vitest';
import { claudeHistory } from './claude-history-mapper';

const entry = (native: unknown, timestamp?: string) => ({
  kind: 'x',
  native,
  ...(timestamp === undefined ? {} : { timestamp }),
});

describe('claudeHistory', () => {
  it('reads user text and assistant text with tool calls', () => {
    const history = claudeHistory([
      entry({ type: 'user', message: { role: 'user', content: 'hello' } }, 't1'),
      entry({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'text', text: 'looking' },
            { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.ts' } },
          ],
        },
      }),
    ]);
    expect(history).toEqual([
      { _tag: 'Message', role: 'User', text: 'hello', timestamp: 't1' },
      { _tag: 'Message', role: 'Assistant', text: 'looking' },
      { _tag: 'ToolCall', toolName: 'Read', input: '{"file_path":"a.ts"}' },
    ]);
  });

  it('skips tool results and bookkeeping entries', () => {
    const history = claudeHistory([
      entry({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] } }),
      entry({ type: 'custom-title', title: 'x' }),
      entry({ type: 'mode', mode: 'plan' }),
      entry('not an object'),
    ]);
    expect(history).toEqual([]);
  });

  it('skips messages the harness injected instead of the user', () => {
    const history = claudeHistory([
      entry({ type: 'user', isMeta: true, message: { role: 'user', content: '<system-reminder>x</system-reminder>' } }),
      entry({
        type: 'user',
        origin: { kind: 'task-notification' },
        message: { role: 'user', content: '<task-notification>y</task-notification>' },
      }),
    ]);
    expect(history).toEqual([]);
  });

  it('AC 3: rebuilds the images of a user message from the recorded image blocks', () => {
    const history = claudeHistory([
      entry({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
            { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: 'BBBB' } },
          ],
        },
      }),
    ]);
    expect(history).toEqual([
      {
        _tag: 'Message',
        role: 'User',
        text: 'look',
        images: [
          { _tag: 'Image', mediaType: 'image/png', data: 'AAAA' },
          { _tag: 'Image', mediaType: 'image/webp', data: 'BBBB' },
        ],
      },
    ]);
  });

  it('AC 3: an image-only message keeps its images with empty text', () => {
    const history = claudeHistory([
      entry({
        type: 'user',
        message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/gif', data: 'CCCC' } }] },
      }),
    ]);
    expect(history).toEqual([{ _tag: 'Message', role: 'User', text: '', images: [{ _tag: 'Image', mediaType: 'image/gif', data: 'CCCC' }] }]);
  });

  it('AC 4: a bad image block becomes a placeholder and the rest of the history loads', () => {
    const history = claudeHistory([
      entry({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'broken' },
            { type: 'image', source: { type: 'url', url: 'https://x/y.png' } },
            { type: 'image', source: { type: 'base64', media_type: 'image/bmp', data: 'DDDD' } },
          ],
        },
      }),
      entry({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }),
    ]);
    expect(history).toEqual([
      { _tag: 'Message', role: 'User', text: 'broken', images: [{ _tag: 'Missing' }, { _tag: 'Missing' }] },
      { _tag: 'Message', role: 'Assistant', text: 'ok' },
    ]);
  });
});
