import { type AgentId, OptionId, PermissionRequestId, ToolCallId } from '../../src/shared/chat/ids.model';
import type { PermissionOption, PermissionRequest } from '../../src/shared/chat/permission.model';
import type { PermissionMode } from '../../src/shared/chat/provider.model';
import type { FileDiff, FileLocation, ToolCall, ToolKind, ToolStatus } from '../../src/shared/chat/tool-call.model';
import type { OpenCodePermissionRule, OpenCodeTool, OpenCodeToolStatus, PermissionReply } from './opencode-backend';

/** Pure translation between OpenCode's tools, permissions and rules and the chat domain's. */

export const ALLOW_ONCE = OptionId.make('allow-once');
export const REJECT_ONCE = OptionId.make('reject-once');

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const KINDS: Readonly<Record<string, ToolKind>> = {
  read: 'Read',
  edit: 'Edit',
  multiedit: 'Edit',
  patch: 'Edit',
  apply_patch: 'Edit',
  write: 'Write',
  bash: 'Execute',
  shell: 'Execute',
  grep: 'Search',
  glob: 'Search',
  list: 'Search',
  webfetch: 'Fetch',
  websearch: 'Fetch',
};

const kindOf = (name: string): ToolKind => KINDS[name.toLowerCase()] ?? 'Other';

const STATUSES: Readonly<Record<OpenCodeToolStatus, ToolStatus>> = {
  Pending: 'Pending',
  Running: 'Running',
  Completed: 'Completed',
  Failed: 'Failed',
};

const pathOf = (input: Readonly<Record<string, unknown>>): string | undefined =>
  text(input['filePath']) ?? text(input['path']);

const titleOf = (name: string, kind: ToolKind, input: Readonly<Record<string, unknown>>): string => {
  const path = pathOf(input);
  const command = text(input['command']);
  switch (kind) {
    case 'Execute':
      return command === undefined ? 'Run command' : `Run ${command}`;
    case 'Read':
    case 'Edit':
    case 'Write':
      return path === undefined ? name : `${kind} ${path}`;
    default:
      return text(input['pattern']) ?? text(input['url']) ?? name;
  }
};

const diffsOf = (kind: ToolKind, input: Readonly<Record<string, unknown>>): ReadonlyArray<FileDiff> => {
  const path = pathOf(input);
  if (path === undefined) return [];
  if (kind === 'Edit') {
    const newText = text(input['newString']);
    if (newText === undefined) return [];
    const oldText = text(input['oldString']);
    return [{ path, ...(oldText === undefined ? {} : { oldText }), newText }];
  }
  if (kind === 'Write') {
    const content = text(input['content']);
    return content === undefined ? [] : [{ path, newText: content }];
  }
  return [];
};

export const describeTool = (agentId: AgentId, tool: OpenCodeTool): ToolCall => {
  const kind = kindOf(tool.name);
  const path = pathOf(tool.input);
  const locations: ReadonlyArray<FileLocation> = path === undefined ? [] : [{ path }];
  return {
    id: ToolCallId.make(tool.id),
    agentId,
    name: tool.name,
    kind,
    title: titleOf(tool.name, kind, tool.input),
    status: STATUSES[tool.status],
    locations,
    diffs: diffsOf(kind, tool.input),
    ...(tool.output === undefined ? {} : { output: tool.output }),
  };
};

/** Allow once or deny: "always" is never offered, so Timmy never writes a persistent OpenCode rule for the user. */
const ASK_OPTIONS: readonly [PermissionOption, ...PermissionOption[]] = [
  { id: ALLOW_ONCE, label: 'Allow', kind: 'AllowOnce' },
  { id: REJECT_ONCE, label: 'Deny', kind: 'RejectOnce' },
];

/** `known` is the tool call the Ask is about, when OpenCode named one we have seen. */
export const buildAsk = (
  ask: { readonly id: string; readonly action: string; readonly resources: ReadonlyArray<string> },
  agentId: AgentId,
  known: ToolCall | undefined,
): PermissionRequest => {
  const kind = kindOf(ask.action);
  const toolCall: ToolCall = known ?? {
    id: ToolCallId.make(ask.id),
    agentId,
    name: ask.action,
    kind,
    title: [ask.action, ...ask.resources].join(' '),
    status: 'Pending',
    locations: [],
    diffs: [],
  };
  return { id: PermissionRequestId.make(ask.id), agentId, toolCall, options: ASK_OPTIONS };
};

/** What to tell OpenCode for the user's answer. Anything but an explicit allow is a rejection. */
export const replyFor = (optionId: OptionId | undefined): PermissionReply => (optionId === ALLOW_ONCE ? 'once' : 'reject');

export const optionFor = (reply: PermissionReply): OptionId => (reply === 'once' ? ALLOW_ONCE : REJECT_ONCE);

const rule = (action: string, effect: OpenCodePermissionRule['effect']): OpenCodePermissionRule => ({
  action,
  resource: '*',
  effect,
});

/**
 * The standing rules for a session. Later rules override earlier ones. `Plan` has no entry: OpenCode 2 ships no
 * plan agent, so the Adapter does not offer it.
 */
export const rulesFor = (mode: Exclude<PermissionMode, 'Plan'>): ReadonlyArray<OpenCodePermissionRule> => {
  switch (mode) {
    case 'Auto':
      return [rule('*', 'allow')];
    case 'AutoAccept':
      return [rule('edit', 'allow'), rule('bash', 'ask')];
    case 'Default':
      return [rule('edit', 'ask'), rule('bash', 'ask')];
  }
};
