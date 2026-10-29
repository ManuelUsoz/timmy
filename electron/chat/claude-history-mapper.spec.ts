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
});
