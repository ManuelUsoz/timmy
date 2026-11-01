import { AppInfoRpcs } from '../app-info/app-info.rpc';
import { ChatRpcs } from '../chat/chat.rpc';
import { SessionsRpcs } from '../sessions/sessions.rpc';
import { SettingsRpcs } from '../settings/settings.rpc';
import { WindowRpcs } from '../window/window.rpc';

/** The single RPC contract between renderer and main. Merge new domain groups here. */
export const DesktopRpcs = AppInfoRpcs.merge(ChatRpcs).merge(SessionsRpcs).merge(WindowRpcs).merge(SettingsRpcs);
