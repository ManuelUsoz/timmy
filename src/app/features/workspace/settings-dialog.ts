import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, untracked, viewChild } from '@angular/core';
import { Schema } from 'effect';
import type { HookStatus } from '../../../shared/hooks/hooks.model';
import {
  allAlertTypes,
  allChannels,
  allProviders,
  Language,
  type AlertType,
  type Channel,
  type Provider,
} from '../../../shared/settings/settings.model';
import { HookSettings } from '../../core/hook-settings';
import { I18n } from '../../core/i18n';
import type { MessageKey } from '../../core/i18n-dictionaries';
import { NotificationSettings } from '../../core/notification-settings';
import { ProviderSettings, providerNames } from '../../core/provider-settings';
import { shortcuts, type ShortcutGroup } from '../../core/shortcuts';
import { ButtonComponent } from '../../shared/ui/button/button';
import { ProviderIconComponent, type Provider as ProviderMark } from '../../shared/ui/provider-icon/provider-icon';
import { StateComponent } from '../../shared/ui/state/state';
import { TagComponent } from '../../shared/ui/tag/tag';
import { SettingsDialogState, settingsSections, type SettingsSection } from './settings-dialog-state';

const SHORTCUT_GROUP_TITLE = {
  workspace: 'shortcuts.group.workspace',
  pane: 'shortcuts.group.pane',
} as const satisfies Record<ShortcutGroup, MessageKey>;

/** How the nav and the header present a section. `soon` sections have no settings yet. */
interface SectionView {
  readonly id: SettingsSection;
  readonly title: MessageKey;
  readonly help: MessageKey;
  readonly soon: boolean;
  /** Stroke paths and circles of its 16x16 icon. */
  readonly paths: ReadonlyArray<string>;
  readonly circles: ReadonlyArray<readonly [number, number, number]>;
}

const sectionViews: Readonly<Record<SettingsSection, Omit<SectionView, 'id'>>> = {
  general: {
    title: 'settings.general',
    help: 'settings.general.help',
    soon: false,
    paths: ['M2 5h6M11 5h3M2 11h3M8 11h6'],
    circles: [
      [9.5, 5, 1.5],
      [6.5, 11, 1.5],
    ],
  },
  appearance: {
    title: 'settings.appearance',
    help: 'settings.appearance.help',
    soon: true,
    paths: ['M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z'],
    circles: [[8, 8, 2]],
  },
  shortcuts: {
    title: 'settings.shortcuts',
    help: 'settings.shortcuts.help',
    soon: false,
    paths: ['M1.5 4h13v8h-13zM4 6.5h1M7 6.5h1M10 6.5h1M4 9.5h8'],
    circles: [],
  },
  agents: {
    title: 'settings.agents',
    help: 'settings.agents.help',
    soon: false,
    paths: ['M3 13c0-2.5 2.2-4 5-4s5 1.5 5 4'],
    circles: [[8, 5, 2.5]],
  },
  notifications: {
    title: 'settings.notifications',
    help: 'settings.notifications.help',
    soon: false,
    paths: ['M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 14h3'],
    circles: [],
  },
  permissions: {
    title: 'settings.permissions',
    help: 'settings.permissions.help',
    soon: true,
    paths: ['M4 7h8v6H4zM6 7V5a2 2 0 0 1 4 0v2'],
    circles: [],
  },
  terminal: {
    title: 'settings.terminal',
    help: 'settings.terminal.help',
    soon: true,
    paths: ['M2 3h12v10H2zM5 7l2 1.5L5 10M8.5 10.5H11'],
    circles: [],
  },
  projects: {
    title: 'settings.projects',
    help: 'settings.projects.help',
    soon: true,
    paths: ['M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z'],
    circles: [],
  },
  integrations: {
    title: 'settings.integrations',
    help: 'settings.integrations.help',
    soon: true,
    paths: ['M6 2v3M10 2v3M4 5h8v3a4 4 0 0 1-8 0zM8 12v2'],
    circles: [],
  },
  usage: {
    title: 'settings.usage',
    help: 'settings.usage.help',
    soon: true,
    paths: ['M2 13h12M4 13V8M8 13V4M12 13V9'],
    circles: [],
  },
};

const sections: ReadonlyArray<SectionView> = settingsSections.map((id) => ({ id, ...sectionViews[id] }));

/** What Settings calls each Channel. Adding a Channel adds its name here. */
const channelNames: Readonly<Record<Channel, MessageKey>> = { Toast: 'settings.notifications.channel.Toast' };

const typeNames: Readonly<Record<AlertType, MessageKey>> = {
  Waiting: 'settings.notifications.type.Waiting',
  Done: 'settings.notifications.type.Done',
  Error: 'settings.notifications.type.Error',
};

/** Language names are shown in their own language, whatever the interface language is. */
const languageNames: ReadonlyArray<{ readonly value: Language; readonly label: string }> = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

/** The mark each Provider is drawn with. */
const providerMarks: Readonly<Record<Provider, ProviderMark>> = {
  ClaudeCode: 'claude',
  Codex: 'openai',
  OpenCode: 'opencode',
};

const focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Settings, laid over the Workspace: a nav of sections on the left and the current one on the right. The Workspace
 * renders it while `SettingsDialogState.open()`; it closes itself (Esc, the cross, a click on the backdrop) through
 * the same state, which also remembers the section. Every change is stored as it is made, so there is no Save.
 */
@Component({
  selector: 'app-settings-dialog',
  imports: [ButtonComponent, ProviderIconComponent, StateComponent, TagComponent],
  templateUrl: './settings-dialog.html',
  styleUrl: './settings-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape($event)' },
})
export class SettingsDialog {
  protected readonly i18n = inject(I18n);
  protected readonly state = inject(SettingsDialogState);
  protected readonly providerSettings = inject(ProviderSettings);
  protected readonly hookSettings = inject(HookSettings);
  protected readonly notificationSettings = inject(NotificationSettings);

  protected readonly sections = sections;
  protected readonly current = computed(() => sectionViews[this.state.section()]);
  /** The shortcuts by group, in the table's order: the whole Workspace's, then the focused Pane's. */
  protected readonly shortcutGroups = (['workspace', 'pane'] as const).map((group) => ({
    group,
    title: SHORTCUT_GROUP_TITLE[group],
    shortcuts: shortcuts.filter((shortcut) => shortcut.group === group),
  }));
  protected readonly providers = allProviders;
  protected readonly names = providerNames;
  protected readonly marks = providerMarks;
  protected readonly languages = languageNames;
  protected readonly channels = allChannels;
  protected readonly channelNames = channelNames;
  protected readonly alertTypes = allAlertTypes;
  protected readonly typeNames = typeNames;

  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  /** Changes only when the set of enabled Providers does, not on every answer from main. */
  private readonly enabledKey = computed(() => this.providerSettings.enabled().join(','));

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.querySelector<HTMLElement>('nav [aria-current="page"]')?.focus());
    inject(DestroyRef).onDestroy(() => this.opener?.focus());
    // The Hooks are read again whenever Agents is shown, and when a Provider is enabled or disabled while it is:
    // main only offers a Hook for an enabled Provider.
    effect(() => {
      if (this.state.section() !== 'agents') return;
      this.enabledKey();
      untracked(() => this.hookSettings.refresh());
    });
  }

  /** The Hook of a Provider, once the Hooks have been read. */
  protected hookOf(provider: Provider): HookStatus | undefined {
    const hooks = this.hookSettings.state();
    return hooks.status === 'ready' ? hooks.hooks.find((hook) => hook.provider === provider) : undefined;
  }

  protected isEnabled(provider: Provider): boolean {
    return this.providerSettings.enabled().includes(provider);
  }

  protected pick(value: unknown): void {
    if (Schema.is(Language)(value)) this.i18n.setLanguage(value);
  }

  protected onEscape(event: Event): void {
    event.preventDefault();
    this.state.close();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const items = Array.from(this.dialog().nativeElement.querySelectorAll<HTMLElement>(focusable));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
