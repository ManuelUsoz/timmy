import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Schema } from 'effect';
import { I18n } from '../../core/i18n';
import { ChatViewComponent } from '../chat/chat-view';
import { ChatController } from '../chat/chat-controller';
import { WorkspaceComponent } from '../workspace/workspace';
import { AvatarComponent } from '../../shared/ui/avatar/avatar';
import { MenuComponent } from '../../shared/ui/menu/menu';
import { OptionComponent } from '../../shared/ui/menu/option';
import { PillComponent } from '../../shared/ui/pill/pill';
import { WindowMode } from '../../../shared/window/window.model';
import { WindowModeState } from './window-mode-state';

/** Picks the content for the current Window mode. Nothing here changes the mode on its own: only the switcher and double-clicks do. */
@Component({
  selector: 'app-shell',
  imports: [NgTemplateOutlet, ChatViewComponent, WorkspaceComponent, PillComponent, AvatarComponent, MenuComponent, OptionComponent],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  protected readonly windowMode = inject(WindowModeState);
  protected readonly i18n = inject(I18n);
  protected readonly pill = inject(ChatController).pill;
  protected readonly switcherOpen = signal(false);

  /** The Pill window is one row tall and would clip the menu, so there the button goes straight to the Panel. */
  protected toggleSwitcher(): void {
    if (this.windowMode.mode() === 'Pill') this.request('Panel');
    else this.switcherOpen.update((open) => !open);
  }

  protected openPanelFromPill(): void {
    if (this.pill().action !== '') this.request('Panel');
  }

  protected pick(value: unknown): void {
    if (Schema.is(WindowMode)(value)) this.request(value);
  }

  protected close(): void {
    this.windowMode.close();
  }

  /** The empty stretch of the Expanded title bar maximizes or restores on double-click, as a system title bar does. */
  protected toggleMaximize(): void {
    this.windowMode.toggleMaximize();
  }

  protected request(mode: WindowMode): void {
    this.switcherOpen.set(false);
    this.windowMode.request(mode);
  }
}
