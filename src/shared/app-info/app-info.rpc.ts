import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

/** Static facts about the running app. Serializable wire payload. */
export const AppInfo = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  electron: Schema.String,
  chrome: Schema.String,
  node: Schema.String,
  platform: Schema.String,
  /** Working directory of the main process; the chat session runs here. */
  cwd: Schema.String,
}).annotate({ identifier: 'AppInfo' });
export type AppInfo = typeof AppInfo.Type;

export const AppInfoRpcs = RpcGroup.make(Rpc.make('AppInfo.get', { success: AppInfo }));
