import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18n } from '../../core/i18n';
import { ToastService, type Toast } from '../../core/toast';
import { NotificationComponent } from '../../shared/ui/notification/notification';

/**
 * The stack of toasts of the Workspace, at its top-right corner. It floats over the content, so showing or
 * dismissing a toast never moves what is behind it. Newest first. Errors are announced at once, the rest politely.
 */
@Component({
  selector: 'app-toast-host',
  imports: [NotificationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toast-host.html',
  styleUrl: './toast-host.css',
})
export class ToastHost {
  protected readonly i18n = inject(I18n);
  protected readonly service = inject(ToastService);

  protected readonly newestFirst = computed(() => [...this.service.toasts()].reverse());

  protected body(toast: Toast): string {
    return this.i18n.t(toast.body, toast.params);
  }
}
