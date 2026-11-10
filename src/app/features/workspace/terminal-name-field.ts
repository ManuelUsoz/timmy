import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { Cause, Exit, Option } from 'effect';
import { I18n } from '../../core/i18n';
import type { TerminalEntry } from './terminal-entries';
import { TerminalsState } from './terminals-state';

let nextId = 0;

/**
 * Where the user renames a Terminal, in its Stack header or its sidebar row. Enter renames it, unless another Terminal
 * of the Project has that name (any case), or main cannot rename it: then the field stays open and says so. Leaving the
 * field does the same as Enter. Escape, or a blank name, leaves the name as it was.
 */
@Component({
  selector: 'app-terminal-name-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      #field
      class="field"
      type="text"
      spellcheck="false"
      [attr.aria-label]="i18n.t('terminals.rename')"
      [attr.aria-invalid]="error() ? 'true' : null"
      [attr.aria-describedby]="error() ? errorId : null"
      [value]="terminal().name"
      (input)="error.set(undefined)"
      (keydown.enter)="commit(field.value)"
      (keydown.escape)="$event.stopPropagation(); close()"
      (blur)="commit(field.value)"
      (click)="$event.stopPropagation()"
      (dblclick)="$event.stopPropagation()"
    />
    @if (error(); as message) {
      <span class="error" role="alert" [id]="errorId">{{ message }}</span>
    }
  `,
  styleUrl: './terminal-name-field.css',
})
export class TerminalNameField {
  protected readonly i18n = inject(I18n);
  private readonly terminals = inject(TerminalsState);

  readonly terminal = input.required<TerminalEntry>();
  /** The field is done: the Terminal was renamed, or the user left it as it was. */
  readonly done = output<void>();

  protected readonly error = signal<string | undefined>(undefined);
  protected readonly errorId = `terminal-name-error-${nextId++}`;
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  /** A rename on its way to main: Enter or leaving the field meanwhile does nothing. */
  private busy = false;
  private closed = false;

  constructor() {
    afterNextRender(() => {
      this.field().nativeElement.focus();
      this.field().nativeElement.select();
    });
  }

  protected async commit(value: string): Promise<void> {
    if (this.busy || this.closed) return;
    if (value.trim() === '') return this.close();
    this.busy = true;
    const exit = await this.terminals.rename(this.terminal().id, value);
    this.busy = false;
    if (Exit.isSuccess(exit)) return this.close();
    const failure = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
    this.error.set(
      failure?._tag === 'WorkspaceError' && failure.reason === 'NameTaken'
        ? this.i18n.t('terminals.nameTaken', { name: value.trim() })
        : this.i18n.t('terminals.renameFailed'),
    );
  }

  protected close(): void {
    if (this.closed) return;
    this.closed = true;
    this.done.emit();
  }
}
