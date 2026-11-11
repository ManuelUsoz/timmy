import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Effect } from 'effect';
import type { DiffHunk, DiffLine } from '../../../shared/files/files.model';
import { DesktopApi } from '../../core/desktop-api';
import { I18n } from '../../core/i18n';
import { formatSize } from './format-size';

/** What reading a file's change against the last commit gave. Only `changes` has lines to show. */
export type DiffState =
  | { readonly status: 'loading' }
  | { readonly status: 'changes'; readonly untracked: boolean; readonly hunks: ReadonlyArray<DiffHunk> }
  | { readonly status: 'unchanged' }
  | { readonly status: 'binary' }
  | { readonly status: 'tooLarge'; readonly size: number }
  | { readonly status: 'failed'; readonly detail: string };

/**
 * Reads the change of a file of the Project against the last commit (`Files.diff`). A failure, outside a repository too,
 * is a state, not an error: there is nothing to compare, and the file itself can still be read.
 */
export const readDiff = (cwd: string, file: string) =>
  Effect.flatMap(DesktopApi, (desktop) => desktop['Files.diff']({ cwd, file })).pipe(
    Effect.map((diff): DiffState => {
      switch (diff.kind) {
        case 'changes':
          return { status: 'changes', untracked: diff.untracked, hunks: diff.hunks };
        case 'unchanged':
          return { status: 'unchanged' };
        case 'binary':
          return { status: 'binary' };
        case 'tooLarge':
          return { status: 'tooLarge', size: diff.size };
      }
    }),
    Effect.catchTag('FilesError', (error) => Effect.succeed<DiffState>({ status: 'failed', detail: error.detail })),
  );

/** One row of the unified diff: a hunk's header, or a line with its number in the last commit and in the file now. */
type DiffRow =
  | { readonly kind: 'hunk'; readonly text: string }
  | { readonly kind: DiffLine['kind']; readonly old: number | undefined; readonly now: number | undefined; readonly text: string };

const rowsOf = (hunks: ReadonlyArray<DiffHunk>): ReadonlyArray<DiffRow> =>
  hunks.flatMap((hunk) => {
    let old = hunk.oldStart;
    let now = hunk.newStart;
    const lines = hunk.lines.map((line): DiffRow => {
      const row = { kind: line.kind, text: line.text, old: line.kind === 'added' ? undefined : old, now: line.kind === 'removed' ? undefined : now };
      if (line.kind !== 'added') old++;
      if (line.kind !== 'removed') now++;
      return row;
    });
    return [{ kind: 'hunk', text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` } as const, ...lines];
  });

/**
 * A file's change against the last commit (Cambios), unified: each hunk under its header, each line with its number in
 * the last commit and in the file now, and a sign (`+`, `−`) besides its colour, so an added or removed line is told apart
 * without colour. What has no lines (binary, too large, a failed read) is a note. It shows what it is given; reading is
 * the caller's (`readDiff`), so the same diff can decide whether Cambios is offered at all.
 */
@Component({
  selector: 'app-file-diff',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './file-diff.html',
  styleUrl: './file-diff.css',
})
export class FileDiffView {
  protected readonly i18n = inject(I18n);

  /** The file's name, for the region's label. */
  readonly name = input.required<string>();
  readonly diff = input.required<DiffState>();

  protected readonly rows = computed(() => {
    const diff = this.diff();
    return diff.status === 'changes' ? rowsOf(diff.hunks) : [];
  });

  protected size(bytes: number): string {
    return formatSize(bytes);
  }

  protected sign(kind: DiffRow['kind']): string {
    return kind === 'added' ? '+' : kind === 'removed' ? '−' : '';
  }

  protected signLabel(kind: DiffRow['kind']): string | null {
    return kind === 'added' ? this.i18n.t('fileDiff.added') : kind === 'removed' ? this.i18n.t('fileDiff.removed') : null;
  }
}
