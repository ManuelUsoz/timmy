import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
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
import { applyMention, enterFolder, levelRows, mentionContext, type FilesState, type LevelRow } from './file-mentions';
import { applyCommand, filterCommands, slashQuery, type CommandsState } from './slash-commands';

/**
 * The message textarea. Typing `/` at the start opens a list of the provider's commands above it;
 * typing `@` at the start or after a space opens a list of the folder's files.
 * The `@` list shows one folder level at a time: → (or Tab/Enter) on a folder enters it, Tab/Enter on a file inserts it.
 * Focus never leaves the textarea.
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
  readonly files = input<FilesState>({ status: 'idle' });
  /** Enter was pressed with no popup selection to take. */
  readonly submitted = output<void>();
  /** The `@` popup opened; the owner should make sure the file list is loading or loaded. */
  readonly mentionOpened = output<void>();

  private readonly caret = signal(0);
  private readonly dismissed = signal(false);
  protected readonly activeIndex = signal(0);

  private readonly query = computed(() => slashQuery(this.draft(), this.caret()));
  private readonly mention = computed(() => mentionContext(this.draft(), this.caret()));
  protected readonly open = computed(() => this.query() !== undefined && !this.dismissed());
  protected readonly mentionOpen = computed(() => this.mention() !== undefined && !this.dismissed());
  protected readonly matches = computed((): ReadonlyArray<SlashCommand> => {
    const state = this.commands();
    const query = this.query();
    return state.status === 'ready' && query !== undefined ? filterCommands(state.items, query) : [];
  });
  protected readonly mentionMatches = computed((): ReadonlyArray<LevelRow> => {
    const state = this.files();
    const context = this.mention();
    return state.status === 'ready' && context !== undefined ? levelRows(state.entries, context.query) : [];
  });
  protected readonly count = computed(() => (this.open() ? this.matches().length : this.mentionOpen() ? this.mentionMatches().length : 0));
  protected readonly selectable = computed(() => this.count() > 0);
  protected readonly popupOpen = computed(() => this.open() || this.mentionOpen());
  /** The highlighted row, kept inside the list when moving the caret narrows the matches. */
  protected readonly highlighted = computed(() => Math.min(this.activeIndex(), this.count() - 1));

  constructor() {
    let wasOpen = false;
    // Ask the owner for the file list each time the popup opens; it decides whether one is needed.
    effect(() => {
      const now = this.mentionOpen();
      if (now && !wasOpen) this.mentionOpened.emit();
      wasOpen = now;
    });
  }

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
    if (this.popupOpen() && event.key === 'Escape') {
      event.preventDefault();
      this.dismissed.set(true);
      return;
    }
    const plain = !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
    if (this.selectable()) {
      switch (event.key) {
        case 'Tab':
        case 'Enter': {
          if (!plain) break;
          event.preventDefault();
          this.pickAt(this.highlighted());
          return;
        }
        case 'ArrowRight': {
          // Only a clear "go in" gesture: otherwise the arrow keeps moving the caret through the text.
          if (!plain || !this.mentionOpen() || this.mentionMatches()[this.highlighted()]?.kind !== 'folder' || !this.caretAtWordEnd()) break;
          event.preventDefault();
          this.pickAt(this.highlighted());
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

  protected pickAt(index: number): void {
    const command = this.open() ? this.matches()[index] : undefined;
    const entry = command === undefined && this.mentionOpen() ? this.mentionMatches()[index] : undefined;
    const element = this.box().nativeElement;
    const context = this.mention();
    const next =
      command !== undefined
        ? applyCommand(element.value, element.selectionStart, command)
        : entry !== undefined && context !== undefined
          ? entry.kind === 'folder'
            ? enterFolder(element.value, element.selectionStart, context, entry)
            : applyMention(element.value, element.selectionStart, context, entry)
          : undefined;
    if (next === undefined) return;
    // Write the DOM first so the caret survives: the value binding then sees no change.
    element.value = next.text;
    element.setSelectionRange(next.caret, next.caret);
    this.draft.set(next.text);
    this.caret.set(next.caret);
    this.activeIndex.set(0);
  }

  /** The caret sits with no selection at the end of the text or right before whitespace. */
  private caretAtWordEnd(): boolean {
    const { selectionStart, selectionEnd, value } = this.box().nativeElement;
    return selectionStart === selectionEnd && (selectionStart === value.length || /\s/.test(value.charAt(selectionStart)));
  }

  private move(step: number): void {
    const count = this.count();
    this.activeIndex.set((this.highlighted() + step + count) % count);
    afterNextRender(
      () => this.host.nativeElement.querySelector('[data-active]')?.scrollIntoView?.({ block: 'nearest' }),
      { injector: this.injector },
    );
  }
}
