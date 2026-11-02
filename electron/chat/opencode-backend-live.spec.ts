import { describe, expect, it } from 'vitest';
import { translate } from './opencode-backend-live';

type Event = Parameters<typeof translate>[3];

/** Real events carry far more fields than `translate` reads; the spec builds only what it reads. */
const event = (type: string, data: Record<string, unknown>): Event => ({ type, data }) as unknown as Event;

const ROOT = 'ses_root';
const CHILD = 'ses_child';

const run = (events: ReadonlyArray<Event>) => {
  const children = new Map<string, string>();
  return events.flatMap((e) => translate(ROOT, new Map(), children, e));
};

const spawn = event('session.created', { sessionID: CHILD, parentID: ROOT, agent: 'explore', title: 'look around' });

describe('translate: child sessions', () => {
  it('turns a child created under the root into AgentStarted', () => {
    expect(run([spawn])).toEqual([{ _tag: 'AgentStarted', id: CHILD, name: 'explore', task: 'look around' }]);
  });

  it('ignores a session that is not part of the Turn', () => {
    const stranger = event('session.created', { sessionID: 'ses_x', parentID: 'ses_other' });
    expect(run([stranger, event('session.text.delta', { sessionID: 'ses_x', delta: 'hi' })])).toEqual([]);
  });

  it('routes a child its own text, reasoning and usage', () => {
    const tokens = { input: 3, output: 2, reasoning: 0, cache: { read: 1, write: 0 } };
    expect(
      run([
        spawn,
        event('session.text.delta', { sessionID: CHILD, delta: 'a' }),
        event('session.reasoning.delta', { sessionID: CHILD, delta: 'b' }),
        event('session.step.ended', { sessionID: CHILD, tokens, cost: 0 }),
      ]).slice(1),
    ).toMatchObject([
      { _tag: 'TextDelta', agent: CHILD, text: 'a' },
      { _tag: 'ReasoningDelta', agent: CHILD, text: 'b' },
      { _tag: 'StepEnded', agent: CHILD, usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 1 } },
    ]);
  });

  it('keeps root events unrouted', () => {
    expect(run([event('session.text.delta', { sessionID: ROOT, delta: 'a' })])).toEqual([{ _tag: 'TextDelta', text: 'a' }]);
  });

  it('maps a child ending to its outcome and leaves the Turn running', () => {
    const ended = (type: string, extra: Record<string, unknown> = {}) =>
      run([spawn, event(type, { sessionID: CHILD, ...extra })]).slice(1);
    expect(ended('session.execution.succeeded')).toEqual([{ _tag: 'AgentEnded', id: CHILD, outcome: 'Completed' }]);
    expect(ended('session.execution.interrupted')).toEqual([{ _tag: 'AgentEnded', id: CHILD, outcome: 'Cancelled' }]);
    expect(ended('session.execution.failed', { error: { message: 'boom' } })).toEqual([
      { _tag: 'AgentEnded', id: CHILD, outcome: 'Failed', detail: 'boom' },
    ]);
  });

  it('ends the Turn only when the root session ends', () => {
    expect(run([event('session.execution.succeeded', { sessionID: ROOT })])).toEqual([{ _tag: 'Idle' }]);
    expect(run([event('session.execution.failed', { sessionID: ROOT, error: { message: 'boom' } })])).toEqual([
      { _tag: 'Failed', detail: 'boom' },
    ]);
  });

  it('follows a grandchild through its parent', () => {
    const grand = event('session.created', { sessionID: 'ses_grand', parentID: CHILD });
    expect(run([spawn, grand]).at(-1)).toMatchObject({ _tag: 'AgentStarted', id: 'ses_grand', parentId: CHILD });
  });

  it('attributes a child permission request to the child', () => {
    const asked = event('permission.asked', { sessionID: CHILD, id: 'per_1', action: 'shell', resources: ['ls'] });
    expect(run([spawn, asked]).at(-1)).toMatchObject({ _tag: 'PermissionAsked', id: 'per_1', agent: CHILD });
  });
});
