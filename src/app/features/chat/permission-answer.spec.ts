import { describe, expect, it } from 'vitest';
import { AgentId, OptionId, PermissionRequestId, ToolCallId } from '../../../shared/chat/ids.model';
import type { PermissionRequest } from '../../../shared/chat/permission.model';
import type { ToolCall } from '../../../shared/chat/tool-call.model';
import { permissionAnswer } from './permission-answer';

const request = (kinds: ReadonlyArray<PermissionRequest['options'][number]['kind']>): PermissionRequest => ({
  id: PermissionRequestId.make('r'),
  agentId: AgentId.make('a'),
  toolCall: { id: ToolCallId.make('t'), agentId: AgentId.make('a'), name: 'Bash', title: 'git push', status: 'Running', kind: 'Edit' } as ToolCall,
  options: kinds.map((kind) => ({ id: OptionId.make(kind), label: kind, kind })) as unknown as PermissionRequest['options'],
});

describe('permissionAnswer', () => {
  it('Allow selects the allow option, Deny the reject option', () => {
    const r = request(['AllowOnce', 'RejectOnce']);
    expect(permissionAnswer(r, 'Allow')).toEqual({ _tag: 'Selected', requestId: r.id, optionId: 'AllowOnce' });
    expect(permissionAnswer(r, 'Deny')).toEqual({ _tag: 'Selected', requestId: r.id, optionId: 'RejectOnce' });
  });

  it('Deny cancels when no reject option exists', () => {
    const r = request(['AllowOnce']);
    expect(permissionAnswer(r, 'Deny')).toEqual({ _tag: 'Cancelled', requestId: r.id });
  });
});
