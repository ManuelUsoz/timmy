import { AgentId } from '../../src/shared/chat/ids.model';
import type { Usage } from '../../src/shared/chat/usage.model';
import { rootAgentId } from './claude-event-mapper';

/** OpenCode names a child by its session id; the root agent is the session itself. */
export const agentIdOf = (agent: string | undefined): AgentId => (agent === undefined ? rootAgentId : AgentId.make(agent));

/** The key per-agent state is kept under; the root agent has none of its own. */
export const agentKey = (agent: string | undefined): string => agent ?? '';

const sum = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);

/** Adds one step's usage to a running total; optional counters stay absent until a step reports them. */
export const addUsage = (total: Usage, step: Usage): Usage => {
  const cacheReadTokens = sum(total.cacheReadTokens, step.cacheReadTokens);
  const cacheWriteTokens = sum(total.cacheWriteTokens, step.cacheWriteTokens);
  const reasoningTokens = sum(total.reasoningTokens, step.reasoningTokens);
  const costUsd = sum(total.costUsd, step.costUsd);
  return {
    inputTokens: total.inputTokens + step.inputTokens,
    outputTokens: total.outputTokens + step.outputTokens,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
  };
};
