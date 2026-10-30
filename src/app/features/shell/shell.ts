import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ChatViewComponent } from '../chat/chat-view';
import { ChatController } from '../chat/chat-controller';
import { AvatarComponent } from '../../shared/ui/avatar/avatar';
import { MenuComponent } from '../../shared/ui/menu/menu';
import { OptionComponent } from '../../shared/ui/menu/option';
import { PillComponent } from '../../shared/ui/pill/pill';
import type { WindowMode } from '../../../shared/window/window.model';
import { WindowModeState } from './window-mode-state';


/** Picks the content for the current Window mode. Nothing here changes the mode on its own: only the switcher and double-clicks do. */
@Component({
  selector: 'app-shell',
  imports: [NgTemplateOutlet, ChatViewComponent, PillComponent, AvatarComponent, MenuComponent, OptionComponent],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  protected readonly windowMode = inject(WindowModeState);
  protected readonly pill = inject(ChatController).pill;
  protected readonly switcherOpen = signal(false);

  /** The Pill window is one row tall and would clip the menu, so there the button goes straight to the Panel. */
  protected toggleSwitcher(): void {
    if (this.windowMode.mode() === 'Pill') this.request('Panel');
    else this.switcherOpen.set(!this.switcherOpen());
  }

  protected close(): void {
    this.windowMode.close();
  }

  protected request(mode: WindowMode): void {
    this.switcherOpen.set(false);
    this.windowMode.request(mode);
  }
}
