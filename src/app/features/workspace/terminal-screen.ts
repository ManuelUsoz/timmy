import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18n } from '../../core/i18n';
import { ButtonComponent } from '../../shared/ui/button/button';
import { StateComponent } from '../../shared/ui/state/state';
import type { TerminalEntry } from './terminal-entries';
import { SAMPLE_EXIT_CODE, sampleOutput } from './terminal-sample';
import { terminalStateKey, terminalTone } from './terminal-view';

/**
 * A terminal, as the design draws it: header, output and status bar, and for a failed one the banner above the
 * output. Purely presentational and static: the state it shows is the entry's, and the buttons are inert until
 * there is a process to act on.
 */
@Component({
  selector: 'app-terminal-screen',
  imports: [ButtonComponent, StateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './terminal-screen.html',
  styleUrl: './terminal-screen.css',
})
export class TerminalScreen {
  protected readonly i18n = inject(I18n);
  protected readonly tone = terminalTone;
  protected readonly stateKey = terminalStateKey;
  protected readonly exitCode = SAMPLE_EXIT_CODE;

  readonly terminal = input.required<TerminalEntry>();
  /** The folder the terminal opens in: the project's. */
  readonly cwd = input.required<string>();

  protected readonly lines = computed(() => sampleOutput(this.terminal().state, this.cwd()));
  /** The caret waits at the end of the output of a terminal that has a prompt. */
  protected readonly caret = computed(() => this.terminal().state === 'Idle' || this.terminal().state === 'Live');
}
