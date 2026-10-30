import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Effect, Exit } from 'effect';
import type { RpcClientError } from 'effect/rpc';
import type { FolderInspection, Project } from '../../../shared/projects/projects.model';
import type { ProjectsError } from '../../../shared/projects/projects-error.model';
import { DesktopApi, type DesktopApiShape } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { ToastService } from '../../core/toast';
import { ButtonComponent } from '../../shared/ui/button/button';
import { StateComponent } from '../../shared/ui/state/state';
import { TextInputComponent } from '../../shared/ui/text-input/text-input';

type Inspection =
  | { readonly status: 'idle' }
  | { readonly status: 'inspecting' }
  | { readonly status: 'ready'; readonly info: FolderInspection };

/** A failure the user can act on, taken from the wire error of a Projects call. */
interface Failure {
  readonly reason: ProjectsError['reason'];
  readonly detail: string;
}

/** What a Projects call came to: its value, or the failure the user can act on. */
type Outcome<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly failure: Failure };

/** The last part of a path, in either separator style. */
const folderName = (folder: string): string => folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;

/**
 * "Nuevo proyecto": pick a folder with the system dialog, see its real git branch, optionally name it and create
 * it. A folder without git offers `git init`. Creating is only possible from a git repository that is not
 * already a project.
 */
@Component({
  selector: 'app-new-project-dialog',
  imports: [FormsModule, ButtonComponent, StateComponent, TextInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-project-dialog.html',
  styleUrl: './new-project-dialog.css',
  host: { '(keydown.escape)': 'closed.emit()' },
})
export class NewProjectDialog {
  private readonly runtime = inject(EffectRuntime);
  protected readonly i18n = inject(I18n);
  private readonly toasts = inject(ToastService);

  readonly closed = output<void>();
  readonly created = output<Project>();

  private readonly browseEl = viewChild('browseButton', { read: ElementRef<HTMLButtonElement> });

  protected readonly inspection = signal<Inspection>({ status: 'idle' });
  protected readonly name = signal('');
  protected readonly initializing = signal(false);
  protected readonly creating = signal(false);
  /** Why the last pick, `git init` or create failed, when it is about the folder in the field. */
  protected readonly failure = signal<Failure | null>(null);

  protected readonly info = computed(() => {
    const inspection = this.inspection();
    return inspection.status === 'ready' ? inspection.info : undefined;
  });
  protected readonly existingName = computed(() => this.info()?.existingName ?? null);
  protected readonly folderPath = computed(() => this.info()?.path ?? '');
  protected readonly placeholder = computed(() => {
    const info = this.info();
    return info === undefined ? '' : folderName(info.path);
  });
  protected readonly busy = computed(() => this.initializing() || this.creating() || this.inspection().status === 'inspecting');
  protected readonly canCreate = computed(() => {
    const info = this.info();
    return info !== undefined && info.branch !== null && info.existingName === null && !this.busy();
  });

  /** The text of a failure: the translated reason, and what git said when git refused. */
  protected readonly failureText = computed(() => {
    const failure = this.failure();
    if (failure === null) return null;
    switch (failure.reason) {
      case 'ProjectNotFound':
        return this.i18n.t('projectsError.ProjectNotFound');
      case 'AlreadyAdded':
        return this.i18n.t('projectsError.AlreadyAdded');
      case 'FolderNotFound':
        return this.i18n.t('projectsError.FolderNotFound');
      case 'NotAGitRepository':
        return this.i18n.t('projectsError.NotAGitRepository');
      case 'GitUnavailable':
        return this.i18n.t('projectsError.GitUnavailable');
      case 'GitInitFailed':
        return this.i18n.t('projectsError.GitInitFailed');
    }
  });

  constructor() {
    afterNextRender(() => this.browseEl()?.nativeElement.focus());
  }

  /** Runs a Projects call and turns its typed failure into data. `null` means the call itself broke (a defect, or no bridge). */
  private attempt<A>(
    call: (desktop: DesktopApiShape) => Effect.Effect<A, ProjectsError | RpcClientError.RpcClientError>,
  ): Promise<Outcome<A> | null> {
    const program = Effect.flatMap(DesktopApi, call).pipe(
      Effect.map((value): Outcome<A> => ({ ok: true, value })),
      Effect.catchTag('ProjectsError', (error) =>
        Effect.succeed<Outcome<A>>({ ok: false, failure: { reason: error.reason, detail: error.detail } }),
      ),
    );
    return this.runtime.run(program).then((exit) => (Exit.isSuccess(exit) ? exit.value : null));
  }

  /**
   * Says why a call failed. What is wrong with the folder in the field (already a project, not a repository, no git)
   * stays in the dialog next to it; any other result of the user's action is a toast.
   */
  private report(failure: Failure): void {
    switch (failure.reason) {
      case 'AlreadyAdded':
      case 'NotAGitRepository':
      case 'GitUnavailable':
        this.failure.set(failure);
        return;
      case 'ProjectNotFound':
      case 'FolderNotFound':
      case 'GitInitFailed':
        this.toasts.error(`projectsError.${failure.reason}`, { detail: failure.detail });
        return;
    }
  }

  protected async browse(): Promise<void> {
    const picked = await this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Projects.pickFolder']()));
    if (picked._tag !== 'Success' || picked.value === null) return;
    await this.inspect(picked.value);
  }

  private async inspect(path: string): Promise<void> {
    this.failure.set(null);
    this.inspection.set({ status: 'inspecting' });
    const result = await this.attempt((desktop) => desktop['Projects.inspectFolder']({ path }));
    if (result?.ok === true) {
      this.inspection.set({ status: 'ready', info: result.value });
      return;
    }
    this.inspection.set({ status: 'idle' });
    if (result?.ok === false) this.report(result.failure);
  }

  protected async initGit(): Promise<void> {
    const info = this.info();
    if (info === undefined) return;
    this.failure.set(null);
    this.initializing.set(true);
    const result = await this.attempt((desktop) => desktop['Projects.initGit']({ path: info.path }));
    this.initializing.set(false);
    if (result === null) return;
    if (result.ok) this.inspection.set({ status: 'ready', info: result.value });
    else this.report(result.failure);
  }

  protected async create(): Promise<void> {
    const info = this.info();
    if (info === undefined || !this.canCreate()) return;
    this.failure.set(null);
    this.creating.set(true);
    const name = this.name().trim();
    const result = await this.attempt((desktop) =>
      desktop['Projects.add']({ path: info.path, ...(name === '' ? {} : { name }) }),
    );
    this.creating.set(false);
    if (result === null) return;
    if (result.ok) {
      this.created.emit(result.value);
      return;
    }
    this.report(result.failure);
    // Somebody else may have added the folder meanwhile: look again so the dialog says so.
    if (result.failure.reason === 'AlreadyAdded') await this.inspect(info.path);
  }
}
