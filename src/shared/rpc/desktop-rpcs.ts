import { AppInfoRpcs } from '../app-info/app-info.rpc';
import { AttachmentsRpcs } from '../attachments/attachments.rpc';
import { ChatRpcs } from '../chat/chat.rpc';
import { FilesRpcs } from '../files/files.rpc';
import { ProjectsRpcs } from '../projects/projects.rpc';
import { SessionsRpcs } from '../sessions/sessions.rpc';
import { SettingsRpcs } from '../settings/settings.rpc';
import { TerminalRpcs } from '../terminal/terminal.rpc';
import { WindowRpcs } from '../window/window.rpc';

/** The single RPC contract between renderer and main. Merge new domain groups here. */
const OptionalRpcs = AttachmentsRpcs.merge(TerminalRpcs);
export const DesktopRpcs = AppInfoRpcs.merge(ChatRpcs).merge(SessionsRpcs).merge(WindowRpcs).merge(SettingsRpcs).merge(ProjectsRpcs).merge(FilesRpcs).merge(OptionalRpcs);
