import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { AgentId, OptionId, PermissionRequestId, QuestionId, QuestionRequestId } from '../../src/shared/chat/ids.model';
import { PermissionOption, PermissionRequest, PermissionResponse } from '../../src/shared/chat/permission.model';
import { Question, QuestionRequest, QuestionResponse } from '../../src/shared/chat/question.model';
import { ToolCall } from '../../src/shared/chat/tool-call.model';

/**
 * Pure bridging between the SDK's `canUseTool` callback and the chat domain's
 * permission and question requests.
 */

export const ALLOW_ONCE = OptionId.make('allow-once');
export const ALLOW_ALWAYS = OptionId.make('allow-always');
export const REJECT_ONCE = OptionId.make('reject-once');

const nonEmpty = <A>(items: ReadonlyArray<A>): readonly [A, ...A[]] | undefined => {
  const [first, ...rest] = items;
  return first === undefined ? undefined : [first, ...rest];
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

// -------------------------------------------------------------- permissions

/** `canAlwaysAllow`: the SDK offered rule suggestions and did not forbid a persistent allow. */
export const buildPermissionRequest = (
  toolUseId: string,
  agentId: AgentId,
  toolCall: ToolCall,
  canAlwaysAllow: boolean,
): PermissionRequest => {
  const options: readonly [PermissionOption, ...PermissionOption[]] = [
    { id: ALLOW_ONCE, label: 'Allow', kind: 'AllowOnce' },
    ...(canAlwaysAllow
      ? [{ id: ALLOW_ALWAYS, label: 'Always allow', kind: 'AllowAlways' } satisfies PermissionOption]
      : []),
    { id: REJECT_ONCE, label: 'Deny', kind: 'RejectOnce' },
  ];
  return { id: PermissionRequestId.make(toolUseId), agentId, toolCall, options };
};

export const permissionResult = (
  response: PermissionResponse,
  input: Readonly<Record<string, unknown>>,
  suggestions: ReadonlyArray<PermissionUpdate> | undefined,
): PermissionResult => {
  if (response._tag === 'Cancelled') {
    return { behavior: 'deny', message: 'The user cancelled the request', interrupt: true };
  }
  if (response.optionId === ALLOW_ONCE) return { behavior: 'allow', updatedInput: { ...input } };
  if (response.optionId === ALLOW_ALWAYS) {
    return {
      behavior: 'allow',
      updatedInput: { ...input },
      ...(suggestions === undefined ? {} : { updatedPermissions: [...suggestions] }),
    };
  }
  return { behavior: 'deny', message: 'The user denied this tool call' };
};

// ---------------------------------------------------------------- questions

const buildQuestion = (raw: unknown, index: number): Question | undefined => {
  if (!isRecord(raw) || !Array.isArray(raw['options'])) return undefined;
  const options = nonEmpty(
    raw['options'].map((option: unknown, optionIndex) => ({
      id: OptionId.make(`${index}-${optionIndex}`),
      label: isRecord(option) ? text(option['label']) : '',
      ...(isRecord(option) && text(option['description']) !== '' ? { description: text(option['description']) } : {}),
    })),
  );
  if (options === undefined) return undefined;
  return {
    id: QuestionId.make(`q${index}`),
    ...(text(raw['header']) === '' ? {} : { header: text(raw['header']) }),
    prompt: text(raw['question']),
    options,
    multiple: raw['multiSelect'] === true,
    // The SDK always lets the user type their own answer ("Other").
    allowCustom: true,
  };
};

/** Parses the `AskUserQuestion` tool input; `undefined` when it has no usable question. */
export const buildQuestionRequest = (
  toolUseId: string,
  agentId: AgentId,
  input: Readonly<Record<string, unknown>>,
): QuestionRequest | undefined => {
  const raw = input['questions'];
  if (!Array.isArray(raw)) return undefined;
  const questions = nonEmpty(
    raw.flatMap((question: unknown, index) => {
      const built = buildQuestion(question, index);
      return built === undefined ? [] : [built];
    }),
  );
  return questions === undefined ? undefined : { id: QuestionRequestId.make(toolUseId), agentId, questions };
};

/**
 * The tool expects `answers` keyed by question text; a multi-select answer is the
 * chosen labels joined with `, `, and a typed answer is its text.
 */
export const questionResult = (
  request: QuestionRequest,
  input: Readonly<Record<string, unknown>>,
  response: QuestionResponse,
): PermissionResult => {
  if (response._tag === 'Dismissed') {
    return { behavior: 'deny', message: 'The user dismissed the question without answering' };
  }
  const answers = Object.fromEntries(
    response.answers.flatMap((answer) => {
      const question = request.questions.find((q) => q.id === answer.questionId);
      if (question === undefined) return [];
      const labels = answer.selected.flatMap((id) => {
        const option = question.options.find((o) => o.id === id);
        return option === undefined ? [] : [option.label];
      });
      const parts = answer.custom === undefined ? labels : [...labels, answer.custom];
      return [[question.prompt, parts.join(', ')] as const];
    }),
  );
  return { behavior: 'allow', updatedInput: { ...input, answers } };
};
