import { Schema } from 'effect';
import { AgentId, OptionId, QuestionId, QuestionRequestId } from './ids.model';

export const QuestionOption = Schema.Struct({
  id: OptionId,
  label: Schema.String,
  description: Schema.optionalKey(Schema.String),
}).annotate({ identifier: 'QuestionOption' });
export type QuestionOption = typeof QuestionOption.Type;

export const Question = Schema.Struct({
  /** Unique within its request; answers refer to it. */
  id: QuestionId,
  /** Short chip label, e.g. `Auth method`. */
  header: Schema.optionalKey(Schema.String),
  prompt: Schema.String,
  options: Schema.NonEmptyArray(QuestionOption),
  /** `true`: checkboxes (pick several); `false`: radio (pick one). */
  multiple: Schema.Boolean,
  /** Whether the user may type a free-text answer instead of (or besides) the options. */
  allowCustom: Schema.Boolean,
}).annotate({ identifier: 'Question' });
export type Question = typeof Question.Type;

/** The agent asks one or more questions and waits for all answers. */
export const QuestionRequest = Schema.Struct({
  id: QuestionRequestId,
  agentId: AgentId,
  questions: Schema.NonEmptyArray(Question),
}).annotate({ identifier: 'QuestionRequest' });
export type QuestionRequest = typeof QuestionRequest.Type;

export const QuestionAnswer = Schema.Struct({
  questionId: QuestionId,
  /** Chosen option ids: exactly one when `multiple` is false, possibly none when custom is used. */
  selected: Schema.Array(OptionId),
  custom: Schema.optionalKey(Schema.String),
}).annotate({ identifier: 'QuestionAnswer' });
export type QuestionAnswer = typeof QuestionAnswer.Type;

export const QuestionResponse = Schema.Union([
  Schema.TaggedStruct('Answered', {
    requestId: QuestionRequestId,
    answers: Schema.NonEmptyArray(QuestionAnswer),
  }),
  Schema.TaggedStruct('Dismissed', { requestId: QuestionRequestId }),
]).annotate({ identifier: 'QuestionResponse' });
export type QuestionResponse = typeof QuestionResponse.Type;
