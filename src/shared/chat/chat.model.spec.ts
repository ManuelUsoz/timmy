import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { ChatEvent } from './event.model';
import { AgentId, OptionId, QuestionId, QuestionRequestId, SessionId, ToolCallId } from './ids.model';
import { QuestionResponse } from './question.model';

const sessionId = SessionId.make('s1');
const agentId = AgentId.make('a1');

describe('chat.model', () => {
  it.effect('decodes a sub-agent tool call with file locations', () =>
    Effect.gen(function* () {
      const event = yield* Schema.decodeUnknownEffect(ChatEvent)({
        _tag: 'ToolCallStarted',
        sessionId,
        call: {
          id: ToolCallId.make('t1'),
          agentId,
          name: 'Edit',
          kind: 'Edit',
          title: 'Edit src/app.ts',
          status: 'Pending',
          locations: [{ path: 'src/app.ts', line: 3 }],
          diffs: [{ path: 'src/app.ts', oldText: 'a', newText: 'b' }],
        },
      });
      expect(event._tag).toBe('ToolCallStarted');
    }));

  it.effect('rejects a question request without options', () =>
    Effect.gen(function* () {
      const exit = yield* Schema.decodeUnknownEffect(ChatEvent)({
        _tag: 'QuestionAsked',
        sessionId,
        request: {
          id: QuestionRequestId.make('q1'),
          agentId,
          questions: [
            { id: QuestionId.make('x'), prompt: 'Pick', options: [], multiple: true, allowCustom: false },
          ],
        },
      }).pipe(Effect.flip);
      expect(exit._tag).toBe('SchemaError');
    }));

  it.effect('decodes a multi-select answer', () =>
    Effect.gen(function* () {
      const response = yield* Schema.decodeUnknownEffect(QuestionResponse)({
        _tag: 'Answered',
        requestId: QuestionRequestId.make('q1'),
        answers: [
          { questionId: QuestionId.make('x'), selected: [OptionId.make('a'), OptionId.make('b')] },
        ],
      });
      expect(response._tag).toBe('Answered');
    }));
});
