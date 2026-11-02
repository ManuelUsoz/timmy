import { type AgentId, OptionId, PermissionRequestId, ToolCallId } from '../../src/shared/chat/ids.model';
import type { PermissionOption, PermissionRequest } from '../../src/shared/chat/permission.model';
import type { Effort, PermissionMode } from '../../src/shared/chat/provider.model';
import type { FileDiff, FileLocation, ToolCall, ToolKind, ToolStatus } from '../../src/shared/chat/tool-call.model';
import type { OpenCodePermissionRule, OpenCodeTool, OpenCodeToolStatus, PermissionReply } from './opencode-backend';

/** Pure translation between OpenCode's tools, permissions and rules and the chat domain's. */

export const ALLOW_ONCE = OptionId.make('allow-once');
export const REJECT_ONCE = OptionId.make('reject-once');

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/**
 * The tools Timmy recognises, by OpenCode's own name. A recognised tool gets the name the UI already shows for
 * the same action on Claude; any other tool (MCP, plugins, new built-ins) keeps its native name under `Other`.
 */
const TOOLS: Readonly<Record<string, { readonly name: string; readonly kind: ToolKind }>> = {
  read: { name: 'Read', kind: 'Read' },
  edit: { name: 'Edit', kind: 'Edit' },
  multiedit: { name: 'Edit', kind: 'Edit' },
  patch: { name: 'Edit', kind: 'Edit' },
  apply_patch: { name: 'Edit', kind: 'Edit' },
  write: { name: 'Write', kind: 'Write' },
  bash: { name: 'Shell', kind: 'Execute' },
  shell: { name: 'Shell', kind: 'Execute' },
  grep: { name: 'Grep', kind: 'Search' },
  glob: { name: 'Glob', kind: 'Search' },
  list: { name: 'List', kind: 'Search' },
  webfetch: { name: 'WebFetch', kind: 'Fetch' },
  websearch: { name: 'WebSearch', kind: 'Fetch' },
};

const identify = (native: string): { readonly name: string; readonly kind: ToolKind } =>
  TOOLS[native.toLowerCase()] ?? { name: native, kind: 'Other' };

const STATUSES: Readonly<Record<OpenCodeToolStatus, ToolStatus>> = {
  Pending: 'Pending',
  Running: 'Running',
  Completed: 'Completed',
  Failed: 'Failed',
};

const pathOf = (input: Readonly<Record<string, unknown>>): string | undefined =>
  text(input['filePath']) ?? text(input['path']);

/** The UI shows the rest of the title after the name, so the title always starts with it. */
const titleOf = (name: string, kind: ToolKind, input: Readonly<Record<string, unknown>>): string => {
  const detail =
    kind === 'Execute'
      ? text(input['command'])
      : kind === 'Read' || kind === 'Edit' || kind === 'Write'
        ? pathOf(input)
        : (text(input['pattern']) ?? text(input['url']));
  return detail === undefined ? name : `${name} ${detail}`;
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
  const { name, kind } = identify(tool.name);
  const path = pathOf(tool.input);
  const locations: ReadonlyArray<FileLocation> = path === undefined ? [] : [{ path }];
  return {
    id: ToolCallId.make(tool.id),
    agentId,
    name,
    kind,
    title: titleOf(name, kind, tool.input),
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
  const { name, kind } = identify(ask.action);
  const toolCall: ToolCall = known ?? {
    id: ToolCallId.make(ask.id),
    agentId,
    name,
    kind,
    title: [name, ...ask.resources].join(' '),
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
      return [rule('edit', 'allow'), rule('shell', 'ask')];
    case 'Default':
      return [rule('edit', 'ask'), rule('shell', 'ask')];
  }
};

/** OpenCode's variant names for the levels Timmy's Effort knows. Variants with other names are not offered. */
const VARIANT_EFFORTS: Readonly<Record<string, Exclude<Effort, 'Default'>>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
};
const EFFORT_VARIANTS: Readonly<Record<Exclude<Effort, 'Default'>, string>> = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  XHigh: 'xhigh',
};

/** Default (no variant) first, then the known levels in Timmy's order. */
export const effortsOf = (variants: ReadonlyArray<string>): ReadonlyArray<Effort> => {
  const offered = new Set(variants.flatMap((variant) => VARIANT_EFFORTS[variant] ?? []));
  return ['Default', ...(['Low', 'Medium', 'High', 'XHigh'] as const).filter((effort) => offered.has(effort))];
};

/** The variant to ask OpenCode for; `Default` and no choice leave the model's own default. */
export const variantFor = (effort: Effort | undefined): string | undefined =>
  effort === undefined || effort === 'Default' ? undefined : EFFORT_VARIANTS[effort];
