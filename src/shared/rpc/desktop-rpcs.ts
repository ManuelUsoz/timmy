import { AppInfoRpcs } from '../app-info/app-info.rpc';
import { FilesRpcs } from '../files/files.rpc';
import { HooksRpcs } from '../hooks/hooks.rpc';
import { ProjectsRpcs } from '../projects/projects.rpc';
import { SettingsRpcs } from '../settings/settings.rpc';
import { TerminalRpcs } from '../terminal/terminal.rpc';
import { WindowRpcs } from '../window/window.rpc';

/** The single RPC contract between renderer and main. Merge new domain groups here. */
export const DesktopRpcs = AppInfoRpcs.merge(WindowRpcs)
  .merge(SettingsRpcs)
  .merge(ProjectsRpcs)
  .merge(FilesRpcs)
  .merge(TerminalRpcs)
  .merge(HooksRpcs);
