import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input, output } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { ChipStripComponent } from '../../shared/ui/chip-strip/chip-strip';
import { MessageComponent } from '../../shared/ui/message/message';
import { TreeViewComponent } from '../../shared/ui/tree-view/tree-view';
import { SelectComponent } from '../../shared/ui/select/select';
import { ButtonComponent } from '../../shared/ui/button/button';
import { TagComponent } from '../../shared/ui/tag/tag';
import { ProviderIconComponent } from '../../shared/ui/provider-icon/provider-icon';
import { AskRowComponent } from '../../shared/ui/ask-row/ask-row';
import { ChatController } from './chat-controller';
import { ChatStopped } from './chat-stopped';
import { ComposerInputComponent } from './composer-input';
import { permissionAnswer } from './permission-answer';
import type { PermissionRequest } from '../../../shared/chat/permission.model';
import { MarkdownPipe } from './markdown.pipe';

@Component({
  imports: [
    MessageComponent,
    ChipStripComponent,
    TreeViewComponent,
    MarkdownPipe,
    ComposerInputComponent,
    ReactiveFormsModule,
    SelectComponent,
    ButtonComponent,
    TagComponent,
    ProviderIconComponent,
    AskRowComponent,
    ChatStopped,
  ],
  selector: 'app-chat-view',
  templateUrl: './chat-view.html',
  styleUrl: './chat-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatViewComponent {
  private readonly controller = inject(ChatController);
  /** In the Workspace the sessions are listed next to the chat, so the chip strip and the new-chat button stay out. */
  readonly embedded = input(false, { transform: booleanAttribute });
  /** Names the session when the chat's own list of sessions does not know it (it is in another project). */
  readonly sessionTitle = input<string>();
  /** "Nueva sesión" was pressed on the note of a stopped session (embedded only). */
  readonly newSession = output<void>();
  protected readonly info = this.controller.info;
  protected readonly error = this.controller.error;
  protected readonly chat = this.controller.chat;
  protected readonly draft = this.controller.draft;
  protected readonly commands = this.controller.commands;
  protected readonly modelOptions = this.controller.modelOptions;
  protected readonly modelControl = this.controller.modelControl;
  protected readonly effortOptions = this.controller.effortOptions;
  protected readonly effortControl = this.controller.effortControl;
  protected readonly permissionOptions = this.controller.permissionOptions;
  protected readonly permissionControl = this.controller.permissionControl;
  protected readonly blocks = this.controller.blocks;
  protected readonly sessionChips = this.controller.sessionChips;
  protected readonly selectedSessionId = this.controller.selectedSessionId;
  protected readonly contextPercent = this.controller.contextPercent;
  protected readonly project = computed(() => this.info()?.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? 'project');
  protected readonly title = computed(
    () => this.sessionTitle() ?? this.sessionChips().find((chip) => chip.id === this.selectedSessionId())?.label ?? 'New session',
  );

  protected send = () => this.controller.send();
  protected stop = () => this.controller.stop();
  protected clearChat = () => this.controller.clearChat();
  protected answer = (request: PermissionRequest, decision: 'Allow' | 'Deny') =>
    this.controller.answerPermission(permissionAnswer(request, decision));
  protected openSession = (id: string) => this.controller.openSession(id);
}
