import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ChatViewComponent } from '../chat/chat-view';
import { ChatController } from '../chat/chat-controller';
import { MenuComponent } from '../../shared/ui/menu/menu';
import { OptionComponent } from '../../shared/ui/menu/option';
import { PillComponent } from '../../shared/ui/pill/pill';
import type { WindowMode } from '../../../shared/window/window.model';
import { WindowModeState } from './window-mode-state';

const MODE_LABEL: Readonly<Record<WindowMode, string>> = { Pill: 'Pill', Panel: 'Panel', Expanded: 'Expanded' };

/** Picks the content for the current Window mode. Nothing here changes the mode on its own: only the switcher and double-clicks do. */
@Component({
  selector: 'app-shell',
  imports: [NgTemplateOutlet, ChatViewComponent, PillComponent, MenuComponent, OptionComponent],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  protected readonly windowMode = inject(WindowModeState);
  protected readonly pill = inject(ChatController).pill;
  protected readonly switcherOpen = signal(false);
  protected readonly label = (mode: WindowMode): string => MODE_LABEL[mode];

  protected request(mode: WindowMode): void {
    this.switcherOpen.set(false);
    this.windowMode.request(mode);
  }
}
