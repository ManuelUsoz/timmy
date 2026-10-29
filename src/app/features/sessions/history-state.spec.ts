import { describe, expect, it } from 'vitest';
import type { HistoryItem } from '../../../shared/sessions/sessions.model';
import { chatStateFromHistory } from './history-state';

describe('chatStateFromHistory', () => {
  it('maps messages and tool calls in order', () => {
    const history: ReadonlyArray<HistoryItem> = [
      { _tag: 'Message', role: 'User', text: 'hi' },
      { _tag: 'Message', role: 'Assistant', text: 'hello' },
      { _tag: 'ToolCall', toolName: 'Read', input: '{"path":"a.ts"}' },
    ];
    const { items, running } = chatStateFromHistory(history);
    expect(running).toBe(false);
    expect(items.map((i) => i.kind)).toEqual(['User', 'Assistant', 'Tool']);
    expect(items[1]).toMatchObject({ kind: 'Assistant', text: 'hello', thinking: '' });
    expect(items[2]).toMatchObject({ kind: 'Tool', call: { name: 'Read', status: 'Completed', output: '{"path":"a.ts"}' } });
  });

  it('gives each item a distinct id', () => {
    const { items } = chatStateFromHistory([
      { _tag: 'Message', role: 'Assistant', text: 'a' },
      { _tag: 'Message', role: 'Assistant', text: 'b' },
    ]);
    const ids = items.flatMap((i) => (i.kind === 'Assistant' ? [i.messageId] : []));
    expect(new Set(ids).size).toBe(2);
  });
});
