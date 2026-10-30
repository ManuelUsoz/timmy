import { Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import type { SessionId } from '../../../shared/chat/ids.model';
import { ChipStripComponent } from '../../shared/ui/chip-strip/chip-strip';
import { MessageComponent } from '../../shared/ui/message/message';
import { TreeViewComponent } from '../../shared/ui/tree-view/tree-view';
import { SelectComponent } from '../../shared/ui/select/select';
import { PillComponent } from '../../shared/ui/pill/pill';
import { SessionComponent } from '../../shared/ui/session/session';
import { SessionsSidebarComponent } from '../sessions/sessions-sidebar';
import { ChatController } from './chat-controller';
import { ComposerInputComponent } from './composer-input';
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
    PillComponent,
    SessionComponent,
    SessionsSidebarComponent,
  ],
  selector: 'app-chat-view',
  templateUrl: './chat-view.html',
  styleUrl: './chat-view.css',
})
export class ChatViewComponent {
  private readonly controller = inject(ChatController);
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
  protected readonly pill = this.controller.pill;
  protected readonly contextPercent = this.controller.contextPercent;

  protected send = () => this.controller.send();
  protected stop = () => this.controller.stop();
  protected clearChat = () => this.controller.clearChat();
  protected showTranscript = (ref: Parameters<ChatController['showTranscript']>[0]) => this.controller.showTranscript(ref);
  protected answerPermission = (r: Parameters<ChatController['answerPermission']>[0]) => this.controller.answerPermission(r);
  protected openSession = (id: string) => this.controller.openSession(id as SessionId);
}
