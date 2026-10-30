import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideWorkspaceRouter } from './features/workspace/workspace.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideWorkspaceRouter(),
  ]
};
