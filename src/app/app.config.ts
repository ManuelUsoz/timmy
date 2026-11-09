import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { Channels } from './features/channels/channels';
import { provideWorkspaceRouter } from './features/workspace/workspace.routes';
import { WorkspacePersistence } from './features/workspace/workspace-persistence';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideWorkspaceRouter(),
    // The Channels alert whatever the Window mode, so they start with the app rather than with a screen.
    provideAppInitializer(() => void inject(Channels)),
    // The layout of the last run comes back (and is kept) whatever the Window mode, so it starts with the app too.
    provideAppInitializer(() => void inject(WorkspacePersistence)),
  ]
};
