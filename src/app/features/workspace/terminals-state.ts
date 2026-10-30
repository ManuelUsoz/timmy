import { Injectable, signal } from '@angular/core';
import type { ProjectId } from '../../../shared/sessions/sessions.model';
import { addTerminal, TerminalId, withState, type TerminalEntry, type TerminalState } from './terminal-entries';

/**
 * UI state of the terminals of the Workspace. In this phase they are only visual: kept in memory for this run
 * of the app, never stored and never sent to main (no RPC), so they are gone on restart.
 */
@Injectable({ providedIn: 'root' })
export class TerminalsState {
  private readonly all = signal<ReadonlyArray<TerminalEntry>>([]);
  readonly entries = this.all.asReadonly();

  /** "Nueva terminal": a local entry in the project. */
  create(projectId: ProjectId): TerminalEntry {
    const id = TerminalId.make(crypto.randomUUID());
    this.all.update((entries) => addTerminal(entries, projectId, id));
    return this.entries().find((entry) => entry.id === id)!;
  }

  find(id: string): TerminalEntry | undefined {
    return this.all().find((entry) => entry.id === id);
  }

  /** The seam for the process that will drive a terminal; until there is one, only tests move a state. */
  setState(id: TerminalId, state: TerminalState): void {
    this.all.update((entries) => withState(entries, id, state));
  }
}
