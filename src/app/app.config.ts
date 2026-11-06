import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { Channels } from './features/channels/channels';
import { provideWorkspaceRouter } from './features/workspace/workspace.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideWorkspaceRouter(),
    // The Channels alert whatever the Window mode, so they start with the app rather than with a screen.
    provideAppInitializer(() => void inject(Channels)),
  ]
};
