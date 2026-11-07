import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, viewChild, viewChildren } from '@angular/core';
import type { TerminalStatus } from '../../../shared/notification/notification.model';
import { I18n } from '../../core/i18n';
import { AvatarComponent } from '../../shared/ui/avatar/avatar';
import { statusTone } from '../../shared/ui/mascot/mascot';
import { StateComponent, type StateTone } from '../../shared/ui/state/state';
import { SwitcherState } from './switcher-state';
import { statusKey } from './terminal-view';

/**
 * The Switcher's dialog: one card per Tab across all Projects, most recent first, each with its Project, its name, its
 * highest Terminal status, the last lines of its focused Terminal and its number key; the search above and the keys
 * below. Keys reach it through the Workspace (see `SwitcherState.key`). A click inside keeps it open for the search; a
 * click on a card goes to its Tab, one on the backdrop cancels.
 */
@Component({
  selector: 'app-switcher',
  imports: [AvatarComponent, StateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './switcher.html',
  styleUrl: './switcher.css',
})
export class Switcher {
  protected readonly i18n = inject(I18n);
  protected readonly state = inject(SwitcherState);
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private readonly cardButtons = viewChildren<ElementRef<HTMLButtonElement>>('card');
  /** Where the keyboard was, to give it back when the Switcher closes without going anywhere. */
  private readonly opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  constructor() {
    // Once it stays open, typing goes to the search.
    effect(() => {
      if (this.state.model()?.sticky === true) this.field().nativeElement.focus();
    });
    // The selected card is always in view.
    effect(() => {
      const selected = this.state.model()?.selected;
      if (selected !== undefined) this.cardButtons()[selected]?.nativeElement.scrollIntoView?.({ block: 'nearest' });
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.state.restoreFocus && this.opener?.isConnected === true) this.opener.focus();
    });
  }

  protected tone(status: TerminalStatus): StateTone {
    return statusTone[status];
  }

  protected word(status: TerminalStatus): string {
    return this.i18n.t(statusKey[status]);
  }
}
