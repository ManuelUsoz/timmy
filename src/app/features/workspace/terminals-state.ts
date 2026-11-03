import { Injectable, signal } from '@angular/core';
import { Effect } from 'effect';
import type { ProjectId } from '../../../shared/sessions/sessions.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { addTerminal, withOutput, withState, type TerminalEntry, type TerminalState } from './terminal-entries';

@Injectable({ providedIn: 'root' })
export class TerminalsState {
  private readonly all = signal<ReadonlyArray<TerminalEntry>>([]);
  readonly entries = this.all.asReadonly();

  constructor(private readonly runtime: EffectRuntime) {}

  async createLive(projectId: ProjectId, cwd: string): Promise<TerminalEntry | undefined> {
    const result = await this.runtime.run(
      Effect.gen(function* () {
        const desktop = yield* DesktopApi;
        return yield* desktop['Terminal.create']({ cwd });
      }),
    );
    if (result._tag === 'Failure') return undefined;
    const entry = addTerminal(this.all(), projectId, result.value.terminalId).at(-1)!;
    this.all.update((entries) => withState([...entries, entry], entry.id, 'Live'));
    return { ...entry, state: 'Live' };
  }

  create(projectId: ProjectId): TerminalEntry {
    const id = TerminalId.make(crypto.randomUUID());
    const entry = addTerminal(this.all(), projectId, id).at(-1)!;
    this.all.update((entries) => [...entries, entry]);
    return entry;
  }

  find(id: string): TerminalEntry | undefined {
    return this.all().find((entry) => entry.id === id);
  }

  appendOutput(id: TerminalId, data: string): void {
    this.all.update((entries) => withOutput(entries, id, data));
  }

  setState(id: TerminalId, state: TerminalState): void {
    this.all.update((entries) => withState(entries, id, state));
  }

  async write(id: TerminalId, data: string): Promise<void> {
    await this.runtime.run(Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      yield* desktop['Terminal.write']({ terminalId: id, data });
    }));
  }

  async resize(id: TerminalId, cols: number, rows: number): Promise<void> {
    await this.runtime.run(Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      yield* desktop['Terminal.resize']({ terminalId: id, cols, rows });
    }));
  }

  async close(id: TerminalId): Promise<void> {
    await this.runtime.run(Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      yield* desktop['Terminal.close']({ terminalId: id });
    }));
    this.all.update((entries) => entries.filter((entry) => entry.id !== id));
  }
}
