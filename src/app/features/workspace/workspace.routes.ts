import { provideRouter, withComponentInputBinding, withDisabledInitialNavigation, withHashLocation, type Routes } from '@angular/router';

const comingSoon = () => import('./coming-soon-screen').then((m) => m.ComingSoonScreen);

/** Entering the Workspace lands on Projects. Chat and History are placeholders for now. */
export const workspaceRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'projects' },
  { path: 'projects', loadComponent: () => import('./projects-screen').then((m) => m.ProjectsScreen) },
  { path: 'chat', loadComponent: comingSoon, data: { title: 'rail.chat' } },
  { path: 'history', loadComponent: comingSoon, data: { title: 'rail.history' } },
  { path: 'settings', loadComponent: () => import('./settings-screen').then((m) => m.SettingsScreen) },
  { path: '**', redirectTo: 'projects' },
];

/**
 * The router is used only inside Expanded (ADR 0005). The renderer loads from `file://`, so the location is
 * the hash. Nothing navigates until the Workspace shows up (see `WorkspaceComponent`), so the Pill and the
 * Panel never touch the URL.
 */
export const provideWorkspaceRouter = () =>
  provideRouter(workspaceRoutes, withHashLocation(), withDisabledInitialNavigation(), withComponentInputBinding());
