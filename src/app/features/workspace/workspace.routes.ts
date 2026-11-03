import {
  provideRouter,
  withComponentInputBinding,
  withDisabledInitialNavigation,
  withHashLocation,
  type Route,
  type Routes,
  type UrlMatchResult,
  type UrlSegment,
} from '@angular/router';

/**
 * One route for the shapes of the Projects area, so moving between them keeps the screen alive:
 * `/projects`, `/projects/:projectId` and `/projects/:projectId/terminals/:terminalId`.
 */
export const projectsMatcher: NonNullable<Route['matcher']> = (segments: UrlSegment[]): UrlMatchResult | null => {
  const [area, projectId, child, terminalId] = segments;
  if (area?.path !== 'projects') return null;
  if (segments.length === 1) return { consumed: segments };
  if (segments.length === 2 && projectId !== undefined) return { consumed: segments, posParams: { projectId } };
  if (segments.length === 4 && projectId !== undefined && terminalId !== undefined && child?.path === 'terminals') {
    return { consumed: segments, posParams: { projectId, terminalId } };
  }
  return null;
};

/** Entering the Workspace lands on Projects. */
export const workspaceRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'projects' },
  { matcher: projectsMatcher, loadComponent: () => import('./projects-screen').then((m) => m.ProjectsScreen) },
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
