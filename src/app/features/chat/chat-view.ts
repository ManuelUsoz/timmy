import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  booleanAttribute,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { ChipStripComponent } from '../../shared/ui/chip-strip/chip-strip';
import { MessageComponent } from '../../shared/ui/message/message';
import { TreeViewComponent } from '../../shared/ui/tree-view/tree-view';
import { SelectComponent } from '../../shared/ui/select/select';
import { ModelPickerComponent } from '../../shared/ui/model-picker/model-picker';
import type { Effort } from '../../../shared/chat/provider.model';
import { ButtonComponent } from '../../shared/ui/button/button';
import { TagComponent } from '../../shared/ui/tag/tag';
import { ProviderIconComponent } from '../../shared/ui/provider-icon/provider-icon';
import { AskRowComponent } from '../../shared/ui/ask-row/ask-row';
import { I18n } from '../../core/i18n';
import { baseName } from './file-mentions';
import type { MessageKey } from '../../core/i18n-dictionaries';
import { sessionStateOf, stateTone } from '../workspace/session-state';
import { StateComponent } from '../../shared/ui/state/state';
import { ChatController } from './chat-controller';
import { ChatStopped } from './chat-stopped';
import { ComposerInputComponent } from './composer-input';
import { permissionAnswer } from './permission-answer';
import type { PermissionRequest } from '../../../shared/chat/permission.model';
import { MarkdownPipe } from './markdown.pipe';
import { ChipComponent } from '../../shared/ui/chip/chip';
import { TooltipComponent } from '../../shared/ui/tooltip/tooltip';
import { splitMentionText } from '../../../shared/chat/mention.model';

@Component({
  imports: [
    MessageComponent,
    ChipComponent,
    TooltipComponent,
    ChipStripComponent,
    TreeViewComponent,
    MarkdownPipe,
    ComposerInputComponent,
    ReactiveFormsModule,
    SelectComponent,
    ModelPickerComponent,
    ButtonComponent,
    TagComponent,
    StateComponent,
    ProviderIconComponent,
    AskRowComponent,
    ChatStopped,
  ],
  selector: 'app-chat-view',
  templateUrl: './chat-view.html',
  styleUrl: './chat-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.empty]': 'empty()' },
})
export class ChatViewComponent {
  private readonly controller = inject(ChatController);
  protected readonly i18n = inject(I18n);
  private readonly log = viewChild.required<ElementRef<HTMLElement>>('log');
  /** The log follows the conversation while the reader is at the bottom; sending a message puts them there. */
  private stickToBottom = true;
  private userMessages = 0;
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
  protected readonly files = this.controller.files;
  protected readonly requestFiles = () => this.controller.requestFiles();
  protected readonly modelOptions = this.controller.modelOptions;
  protected readonly modelControl = this.controller.modelControl;
  protected readonly selectedModel = this.controller.selectedModel;
  protected readonly selectedEffort = this.controller.selectedEffort;
  protected readonly effortOptions = this.controller.effortOptions;
  protected readonly effortControl = this.controller.effortControl;
  protected readonly permissionOptions = this.controller.permissionOptions;
  protected readonly permissionControl = this.controller.permissionControl;
  protected readonly segmentsOf = splitMentionText;
  /** The chip shows the file name; the full path is its tooltip. */
  protected readonly mentionName = baseName;
  protected readonly blocks = this.controller.blocks;
  protected readonly sessionChips = this.controller.sessionChips;
  protected readonly selectedSessionId = this.controller.selectedSessionId;
  protected readonly contextPercent = this.controller.contextPercent;
  protected readonly project = computed(() => this.info()?.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? 'project');
  /** A live session with nothing said yet: the composer sits in the middle, with no panels around it. */
  protected readonly empty = computed(() => this.chat().items.length === 0 && !this.chat().failure && !this.chat().permission);
  private readonly sessionState =computed(() => sessionStateOf(this.chat(), true));
  protected readonly stateTone = computed(() => stateTone(this.sessionState()));
  protected readonly stateLabel = computed(() => this.i18n.t(`state.${this.sessionState().toLowerCase()}` as MessageKey));
  protected readonly title = computed(
    () => this.sessionTitle() ?? this.sessionChips().find((chip) => chip.id === this.selectedSessionId())?.label ?? 'New session',
  );

  constructor() {
    afterRenderEffect(() => {
      const items = this.chat().items; // any change of the chat re-runs this
      const users = items.filter((item) => item.kind === 'User').length;
      if (users > this.userMessages) this.stickToBottom = true;
      this.userMessages = users;
      if (this.stickToBottom) {
        const el = this.log().nativeElement;
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  protected readonly lastIsAgent = computed(() => this.blocks().at(-1)?.kind === 'Agent');

  protected onScroll(): void {
    const el = this.log().nativeElement;
    this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  protected setModel = (id: string | null) => this.modelControl.setValue(id);
  protected setEffort = (effort: string) => this.effortControl.setValue(effort as Effort);
  protected send = () => this.controller.send();
  protected stop = () => this.controller.stop();
  protected clearChat = () => this.controller.clearChat();
  protected answer = (request: PermissionRequest, decision: 'Allow' | 'Deny') =>
    this.controller.answerPermission(permissionAnswer(request, decision));
  protected openSession = (id: string) => this.controller.openSession(id);
}
