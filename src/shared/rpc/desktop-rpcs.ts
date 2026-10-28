import { AppInfoRpcs } from '../app-info/app-info.rpc';
import { ChatRpcs } from '../chat/chat.rpc';

/** The single RPC contract between renderer and main. Merge new domain groups here. */
export const DesktopRpcs = AppInfoRpcs.merge(ChatRpcs);
