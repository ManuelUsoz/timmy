import { describe, expect, it } from 'vitest';
import { initialChatState, type ChatState } from '../chat/chat-state';
import { formatElapsed, pillView } from './pill-view';
import { AgentId, ToolCallId } from '../../../shared/chat/ids.model';
import type { ToolCall } from '../../../shared/chat/tool-call.model';

const tool = (status: ToolCall['status'], name: string, title: string): ChatState['items'][number] => ({
  kind: 'Tool',
  call: { id: ToolCallId.make('t'), agentId: AgentId.make('a'), name, title, status, kind: 'Edit' } as ToolCall,
});

describe('formatElapsed', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(192_000)).toBe('3:12');
    expect(formatElapsed(3_599_000)).toBe('59:59');
  });
});

describe('pillView', () => {
  it('is Idle when nothing runs', () => {
    expect(pillView(initialChatState, 0)).toMatchObject({ tone: 'neutral', label: 'Idle', text: 'Nothing running' });
  });

  it('is Live with the running tool and elapsed time during a Turn', () => {
    const state = { ...initialChatState, running: true, items: [tool('Completed', 'Read', 'a.ts'), tool('Running', 'Edit', 'b.ts')] };
    expect(pillView(state, 12_000)).toEqual({ tone: 'running', label: 'Live', text: 'Edit b.ts', meta: '0:12', pulse: true });
  });

  it('falls back to Working… when no tool is running', () => {
    expect(pillView({ ...initialChatState, running: true }, 0).text).toBe('Working…');
  });
});
