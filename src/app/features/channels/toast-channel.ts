import { Injectable, inject } from '@angular/core';
import type { AlertType } from '../../../shared/settings/settings.model';
import type { MessageKey } from '../../core/i18n-dictionaries';
import { ToastService, type ToastTone } from '../../core/toast';
import { ProjectsState } from '../workspace/projects-state';
import { TerminalsState } from '../workspace/terminals-state';
import type { Alert, ChannelDelivery } from './channel-alerts';

/** How each type reads as a toast. */
const presentation: Readonly<Record<AlertType, { readonly tone: ToastTone; readonly title: MessageKey; readonly body: MessageKey }>> = {
  Waiting: { tone: 'warning', title: 'notifications.waiting.title', body: 'notifications.waiting.body' },
  Done: { tone: 'success', title: 'notifications.done.title', body: 'notifications.done.body' },
  Error: { tone: 'error', title: 'notifications.error.title', body: 'notifications.error.body' },
};

/** The in-app toast Channel: it alerts with the same toasts that tell the results of the user's actions. */
@Injectable({ providedIn: 'root' })
export class ToastChannel implements ChannelDelivery {
  private readonly toasts = inject(ToastService);
  private readonly terminals = inject(TerminalsState);
  private readonly projects = inject(ProjectsState);

  alert(notification: Alert): void {
    const terminal = this.terminals.find(notification.source.terminalId);
    // A Terminal this window does not list cannot be named; there is nothing useful to say about it.
    if (terminal === undefined) return;
    const project = this.projects.all().find((candidate) => candidate.projectId === terminal.projectId)?.name ?? '';
    this.toasts.show({ ...presentation[notification.type], params: { number: terminal.number, project } });
  }
}
