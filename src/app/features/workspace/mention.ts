import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { TerminalStatus } from '../../../shared/notification/notification.model';
import type { ProjectId } from '../../../shared/projects/projects.model';
import type { Provider } from '../../../shared/settings/settings.model';
import { ToastService } from '../../core/toast';
import { lineRange, type LineSelection } from './line-selection';
import { bringForward } from './pane-layout';
import { ProjectsState } from './projects-state';
import { terminalPath } from './tabs';
import { TabsState } from './tabs-state';
import type { TerminalEntry, TerminalId } from './terminal-entries';
import { TerminalsState } from './terminals-state';
import { terminalView } from './views';

/** Control bytes (C0, DEL and C1): none is ever typed into a prompt, so a Mention can never press a key by itself. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * The exact text a Mention types (GLOSSARY: Mention), in the form each Provider reads (research
 * `provider-mention-syntax`): one line, no control bytes, no Enter, one trailing space so the user types on after it.
 * `path` is relative to the Project with `/`. A path with spaces is quoted (Claude Code `@"a b.ts"`; Codex and OpenCode
 * plain `"a b.ts"`, as their `@` pickers close at the first space), unless it already holds a quote.
 *
 * | Provider    | whole file   | lines            |
 * | ----------- | ------------ | ---------------- |
 * | Claude Code | `@src/a.ts ` | `@src/a.ts#9-14 ` |
 * | Codex       | `src/a.ts `  | `src/a.ts:9-14 `  |
 * | OpenCode    | `@src/a.ts ` | `@src/a.ts#9-14 ` |
 */
export const mentionText = (provider: Provider, path: string, lines?: LineSelection): string => {
  const clean = path.replace(CONTROL, '');
  const spaced = /\s/.test(clean);
  const quoted = spaced && !clean.includes('"') ? `"${clean}"` : clean;
  const at = provider === 'ClaudeCode' || (provider === 'OpenCode' && !spaced) ? '@' : '';
  const range = lines === undefined ? '' : `${provider === 'Codex' ? ':' : '#'}${lineRange(lines)}`;
  return `${at}${quoted}${range} `;
};

/** A Terminal a Mention can go to, with what its Hook says now: a Waiting one is offered but cannot take it. */
export interface MentionTarget {
  readonly entry: TerminalEntry & { readonly provider: Provider };
  readonly status: TerminalStatus;
  readonly waiting: boolean;
}

/** The live Terminals of the Project opened with a Provider, in the order they were opened. */
export const mentionTargets = (
  entries: ReadonlyArray<TerminalEntry>,
  projectId: ProjectId,
  statusOf: (id: TerminalId) => TerminalStatus,
): ReadonlyArray<MentionTarget> =>
  entries.flatMap((entry): ReadonlyArray<MentionTarget> => {
    if (entry.projectId !== projectId || entry.state !== 'Live' || entry.provider === undefined) return [];
    const status = statusOf(entry.id);
    return [{ entry: { ...entry, provider: entry.provider }, status, waiting: status === 'Waiting' }];
  });

/** The target a Mention goes to unless the user picks another: the last focused one that is not Waiting. */
export const defaultTarget = (targets: ReadonlyArray<MentionTarget>, focusedAt: (id: TerminalId) => number): MentionTarget | undefined =>
  targets.filter((target) => !target.waiting).reduce<MentionTarget | undefined>((best, target) => (best === undefined || focusedAt(target.entry.id) > focusedAt(best.entry.id) ? target : best), undefined);

/** How long "Mencionado en …" stays: it only confirms what the user just did. */
const MENTION_TOAST_MS = 2500;

/**
 * Mentions (GLOSSARY: Mention, ADR 0008): types a reference to a file, or to its Line selection, into the prompt of an
 * agent's Terminal of the same Project, then puts the user on that Terminal. Never a Message: nothing is queued, nothing
 * is pressed, and a Terminal whose Hook says Waiting is refused (its prompt is a permission question). Terminals with no
 * Hook reporting are Idle here and take it.
 */
@Injectable({ providedIn: 'root' })
export class Mentions {
  private readonly terminals = inject(TerminalsState);
  private readonly tabs = inject(TabsState);
  private readonly projects = inject(ProjectsState);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  /** The Project a Tab belongs to: a File View's Mentions go to Terminals of that Project only. */
  projectOfTab(tabId: string): ProjectId | undefined {
    return this.terminals.entries().find((entry) => entry.tabId === tabId)?.projectId;
  }

  targetsOf(projectId: ProjectId): ReadonlyArray<MentionTarget> {
    return mentionTargets(this.terminals.entries(), projectId, (id) => this.tabs.statusOf(id));
  }

  defaultOf(projectId: ProjectId): MentionTarget | undefined {
    return defaultTarget(this.targetsOf(projectId), (id) => this.terminals.focusedAt(id));
  }

  projectName(projectId: ProjectId): string {
    return this.projects.all().find((project) => project.projectId === projectId)?.name ?? '';
  }

  /**
   * Types the Mention of `path` (and `lines`) into the Terminal, then focuses its View, switching Tab if needed. Refused,
   * with nothing typed, when the Terminal cannot take it (gone, a plain shell, or Waiting). Whether it reached the prompt
   * is not known: a Terminal turning Waiting meanwhile is an accepted race.
   */
  async mention(projectId: ProjectId, id: TerminalId, path: string, lines?: LineSelection): Promise<boolean> {
    const target = this.targetsOf(projectId).find((each) => each.entry.id === id);
    if (target === undefined || target.waiting) return false;
    const { entry } = target;
    const written = await this.terminals.write(entry.id, mentionText(entry.provider, path, lines));
    if (!written) {
      this.toasts.error('mention.failed', { params: { name: entry.name, number: entry.number }, durationMs: MENTION_TOAST_MS });
      return false;
    }
    const tab = this.tabs.tabsOf(projectId).find((each) => each.id === entry.tabId);
    if (tab !== undefined) this.tabs.update(tab, (layout) => bringForward(layout, terminalView(entry.id)));
    await this.router.navigate(terminalPath(entry));
    this.toasts.success('mention.done', { params: { name: entry.name, number: entry.number }, durationMs: MENTION_TOAST_MS });
    return true;
  }
}
