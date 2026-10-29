import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { SlashCommand } from '../../../shared/chat/command.model';
import { applyCommand, filterCommands, slashQuery, type CommandsState } from './slash-commands';

/**
 * The message textarea. Typing `/` at the start opens a list of the provider's commands above it;
 * Tab (or Enter) inserts the highlighted one. Focus never leaves the textarea.
 */
@Component({
  selector: 'app-composer-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './composer-input.html',
  styleUrl: './composer-input.css',
})
export class ComposerInputComponent {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly box = viewChild.required<ElementRef<HTMLTextAreaElement>>('box');

  readonly draft = model.required<string>();
  readonly commands = input.required<CommandsState>();
  /** Enter was pressed with no popup selection to take. */
  readonly submitted = output<void>();

  private readonly caret = signal(0);
  private readonly dismissed = signal(false);
  protected readonly activeIndex = signal(0);

  private readonly query = computed(() => slashQuery(this.draft(), this.caret()));
  protected readonly open = computed(() => this.query() !== undefined && !this.dismissed());
  protected readonly matches = computed((): ReadonlyArray<SlashCommand> => {
    const state = this.commands();
    const query = this.query();
    return state.status === 'ready' && query !== undefined ? filterCommands(state.items, query) : [];
  });
  protected readonly selectable = computed(() => this.open() && this.matches().length > 0);
  /** The highlighted row, kept inside the list when moving the caret narrows the matches. */
  protected readonly highlighted = computed(() => Math.min(this.activeIndex(), this.matches().length - 1));

  protected onInput(): void {
    this.draft.set(this.box().nativeElement.value);
    this.dismissed.set(false);
    this.activeIndex.set(0);
    this.syncCaret();
  }

  protected syncCaret(): void {
    this.caret.set(this.box().nativeElement.selectionStart);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (this.open() && event.key === 'Escape') {
      event.preventDefault();
      this.dismissed.set(true);
      return;
    }
    const plain = !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
    if (this.selectable()) {
      switch (event.key) {
        case 'Tab':
        case 'Enter': {
          const command = this.matches()[this.highlighted()];
          if (command === undefined || !plain) break;
          event.preventDefault();
          this.pick(command);
          return;
        }
        case 'ArrowDown':
          event.preventDefault();
          this.move(1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          this.move(-1);
          return;
      }
    }
    if (event.key === 'Enter' && plain) {
      event.preventDefault();
      this.submitted.emit();
    }
  }

  protected pick(command: SlashCommand): void {
    const element = this.box().nativeElement;
    const next = applyCommand(element.value, element.selectionStart, command);
    // Write the DOM first so the caret survives: the value binding then sees no change.
    element.value = next.text;
    element.setSelectionRange(next.caret, next.caret);
    this.draft.set(next.text);
    this.caret.set(next.caret);
    this.activeIndex.set(0);
  }

  private move(step: number): void {
    const count = this.matches().length;
    this.activeIndex.set((this.highlighted() + step + count) % count);
    afterNextRender(
      () => this.host.nativeElement.querySelector('[data-active]')?.scrollIntoView?.({ block: 'nearest' }),
      { injector: this.injector },
    );
  }
}
