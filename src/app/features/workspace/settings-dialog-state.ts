import { Injectable, signal } from '@angular/core';

/** The sections of Settings, in the order its nav lists them. */
export const settingsSections = [
  'general',
  'appearance',
  'shortcuts',
  'agents',
  'notifications',
  'permissions',
  'terminal',
  'projects',
  'integrations',
  'usage',
] as const;
export type SettingsSection = (typeof settingsSections)[number];

/**
 * Whether Settings is open over the Workspace, and which section it shows. Lives for the app, so reopening Settings
 * lands on the section the user left during this session; the first time it is General.
 */
@Injectable({ providedIn: 'root' })
export class SettingsDialogState {
  private readonly isOpen = signal(false);
  readonly open = this.isOpen.asReadonly();
  readonly section = signal<SettingsSection>('general');

  /** Ctrl+, or the sidebar's Settings button. */
  toggle(): void {
    this.isOpen.update((open) => !open);
  }

  close(): void {
    this.isOpen.set(false);
  }
}
