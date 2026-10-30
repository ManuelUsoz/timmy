import { NgTemplateOutlet } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import type { AgentId } from '../../../shared/chat/ids.model';
import { SelectComponent } from '../../shared/ui/select/select';
import { PillComponent } from '../../shared/ui/pill/pill';
import { SessionComponent } from '../../shared/ui/session/session';
import { SessionsSidebarComponent } from '../sessions/sessions-sidebar';
import { ChatController } from './chat-controller';
import { ComposerInputComponent } from './composer-input';
import { MarkdownPipe } from './markdown.pipe';

@Component({
  imports: [
    NgTemplateOutlet,
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
  protected readonly tree = this.controller.tree;
  protected readonly pill = this.controller.pill;
  protected readonly contextPercent = this.controller.contextPercent;

  protected send = () => this.controller.send();
  protected stop = () => this.controller.stop();
  protected clearChat = () => this.controller.clearChat();
  protected showTranscript = (ref: Parameters<ChatController['showTranscript']>[0]) => this.controller.showTranscript(ref);
  protected answerPermission = (r: Parameters<ChatController['answerPermission']>[0]) => this.controller.answerPermission(r);
  protected agent = (id: AgentId) => this.controller.agent(id);
}
