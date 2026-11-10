import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { Cause, Exit, Option } from 'effect';
import { I18n } from '../../core/i18n';
import type { TerminalEntry } from './terminal-entries';
import { TerminalsState } from './terminals-state';

let nextId = 0;

/**
 * Where the user renames a Terminal, in its Stack header or its sidebar row. Enter renames it, unless another Terminal
 * of the Project has that name (any case): then the field stays open and says so. Escape, or a blank name, leaves the
 * name as it was; leaving the field renames it when it can and closes either way.
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
      (blur)="leave(field.value)"
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
  /** A rename on its way to main: Enter or a blur meanwhile does nothing. */
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
    const taken = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
    this.error.set(
      taken?._tag === 'WorkspaceError' && taken.reason === 'NameTaken'
        ? this.i18n.t('terminals.nameTaken', { name: value.trim() })
        : this.i18n.t('terminals.renameFailed'),
    );
  }

  protected leave(value: string): void {
    if (this.busy || this.closed) return;
    // A name that cannot be used is dropped: what the field said is shown only while it is open.
    if (this.error() === undefined && value.trim() !== '') void this.terminals.rename(this.terminal().id, value);
    this.close();
  }

  protected close(): void {
    if (this.closed) return;
    this.closed = true;
    this.done.emit();
  }
}
