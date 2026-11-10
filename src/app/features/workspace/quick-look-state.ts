import { Injectable, inject, signal } from '@angular/core';
import { FilesBrowser } from './files-browser';
import { ProjectsState } from './projects-state';

/** What an open Quick look shows: the list it walks, where it is in it, and the Project the files are of. */
export interface QuickLookModel {
  /** The Project's folder, which the paths are relative to. */
  readonly cwd: string;
  readonly projectName: string;
  /** The files of the list it was opened from, in order; never a folder. */
  readonly files: ReadonlyArray<string>;
  /** The place in `files` of the file shown. */
  readonly at: number;
}

/**
 * The Quick look (GLOSSARY: Quick look): a modal over the Workspace that shows a file of the selected Project without
 * opening it as a View. It walks the list it was opened from, with no wrap. It is not part of a Tab's layout and nothing
 * of it is saved. Whoever opens it says what to do when it closes (give the keyboard back to the row of the last file).
 */
@Injectable({ providedIn: 'root' })
export class QuickLookState {
  private readonly projects = inject(ProjectsState);
  private readonly browser = inject(FilesBrowser);

  private readonly state = signal<QuickLookModel | undefined>(undefined);
  /** The Quick look on screen, if any. */
  readonly model = this.state.asReadonly();
  private closed: ((last: string) => void) | undefined;

  /**
   * Opens on `path`, one of `files`: the list to walk, as it is now. `closed` runs when it closes, with the last file
   * shown, to give the keyboard back; not when Enter opened that file as a File View, which has the keyboard then.
   */
  open(files: ReadonlyArray<string>, path: string, closed?: (last: string) => void): void {
    const project = this.projects.selected();
    const at = files.indexOf(path);
    if (project === undefined || at === -1) return;
    this.closed = closed;
    this.state.set({ cwd: project.cwd, projectName: project.name, files, at });
  }

  /** Up or Down: the file before or after in the list. The ends do not wrap. */
  step(by: -1 | 1): void {
    this.state.update((model) => (model === undefined ? model : { ...model, at: Math.min(Math.max(model.at + by, 0), model.files.length - 1) }));
  }

  /** Esc or Space: closes it where it is. */
  close(): void {
    const model = this.state();
    if (model === undefined) return;
    const closed = this.closed;
    this.closed = undefined;
    this.state.set(undefined);
    closed?.(model.files[model.at]);
  }

  /** Enter: the file shown opens as a preview File View, and the Quick look closes. A deleted file has nothing to open. */
  confirm(): void {
    const model = this.state();
    if (model === undefined) return;
    const path = model.files[model.at];
    if (this.browser.isDeleted(path)) return;
    const closed = this.closed;
    this.closed = undefined;
    this.state.set(undefined);
    // The File View that took the file has the keyboard; with no Tab to open it in, its row gets it back.
    if (!this.browser.openFile(path)) closed?.(path);
  }
}
