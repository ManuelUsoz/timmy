import type { PermissionRequest } from '../../../shared/chat/permission.model';
import { initialChatState, type ChatState } from '../chat/chat-state';
import { sessionStateOf, stateTone } from './session-state';

const permission = { id: 'p1' } as unknown as PermissionRequest;
const running: ChatState = { ...initialChatState, running: true };
const asking: ChatState = { ...running, permission };

describe('sessionStateOf', () => {
  it('is Live for the open session while a turn runs', () => {
    expect(sessionStateOf(running, true)).toBe('Live');
  });

  it('is Asks for the open session while it waits for an answer, even though the turn is running', () => {
    expect(sessionStateOf(asking, true)).toBe('Asks');
  });

  it('is Idle for the open session between turns', () => {
    expect(sessionStateOf(initialChatState, true)).toBe('Idle');
  });

  it('is Idle for every session that is not the open one, whatever the chat is doing', () => {
    expect(sessionStateOf(running, false)).toBe('Idle');
    expect(sessionStateOf(asking, false)).toBe('Idle');
  });
});

describe('stateTone', () => {
  it('colours Live as success, Asks as info and Idle as idle', () => {
    expect(stateTone('Live')).toBe('success');
    expect(stateTone('Asks')).toBe('info');
    expect(stateTone('Idle')).toBe('idle');
  });
});
