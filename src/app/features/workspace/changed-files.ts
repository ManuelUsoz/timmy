import type { ChangedFile, ChangeKind, FolderEntry } from '../../../shared/files/files.model';
import type { MessageKey } from '../../core/i18n-dictionaries';
import type { TreeNode, TreeNodeFlag, TreeNodeFlagTone } from '../../shared/ui/tree-view/tree-view.types';

/** The letter of each kind and its colour; the letter alone tells them apart. */
const LETTERS: Readonly<Record<ChangeKind, { readonly text: string; readonly tone: TreeNodeFlagTone; readonly label: MessageKey }>> = {
  modified: { text: 'M', tone: 'warning', label: 'files.modified' },
  added: { text: 'A', tone: 'success', label: 'files.added' },
  untracked: { text: 'U', tone: 'info', label: 'files.untracked' },
  deleted: { text: 'D', tone: 'error', label: 'files.deleted' },
  renamed: { text: 'R', tone: 'merged', label: 'files.renamed' },
};

type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

const join = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`);

const byFoldersThenName = (a: { readonly kind: string; readonly name: string }, b: { readonly kind: string; readonly name: string }): number =>
  a.kind === b.kind ? (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1) : a.kind === 'folder' ? -1 : 1;

/**
 * What git says about a Project (GLOSSARY: Changed file), asked the way the tree needs it: the kind of a path, how many
 * changes a folder holds, and what a folder holds that its listing on disk does not (a deleted file, a folder gone).
 */
export class Changes {
  private readonly byPath: ReadonlyMap<string, ChangedFile>;
  private readonly untrackedFolders: ReadonlyArray<string>;

  constructor(readonly entries: ReadonlyArray<ChangedFile>) {
    this.byPath = new Map(entries.map((entry) => [entry.path, entry]));
    this.untrackedFolders = entries.filter((entry) => entry.folder && entry.kind === 'untracked').map((entry) => entry.path);
  }

  /** A path's own kind; a path inside a wholly untracked folder is untracked too. */
  kindOf(path: string): ChangeKind | undefined {
    return this.byPath.get(path)?.kind ?? (this.untrackedFolders.some((folder) => path.startsWith(`${folder}/`)) ? 'untracked' : undefined);
  }

  /** How many changes are below `folder` (an untracked folder below it counts as one). */
  countInside(folder: string): number {
    const prefix = `${folder}/`;
    return this.entries.filter((entry) => entry.path.startsWith(prefix)).length;
  }

  /**
   * What `dir` holds according to git alone: each changed path directly in it, and each folder in it that leads to one.
   * The tree adds those its listing lacks, so a deleted file shows in its folder and a folder gone altogether still shows.
   */
  childrenOf(dir: string): ReadonlyArray<FolderEntry> {
    const prefix = dir === '' ? '' : `${dir}/`;
    const found = new Map<string, FolderEntry>();
    for (const entry of this.entries) {
      if (!entry.path.startsWith(prefix)) continue;
      const rest = entry.path.slice(prefix.length);
      const slash = rest.indexOf('/');
      const name = slash === -1 ? rest : rest.slice(0, slash);
      const kind = slash !== -1 || entry.folder ? 'folder' : 'file';
      if (name !== '' && !found.has(name)) found.set(name, { name, kind, ignored: false });
    }
    return [...found.values()];
  }
}

/** The mark of one row: its own letter, else, for a closed folder, how many changes it holds. */
export const flagOf = (changes: Changes, path: string, closedFolder: boolean, t: Translate): TreeNodeFlag | undefined => {
  const kind = changes.kindOf(path);
  if (kind !== undefined) {
    const letter = LETTERS[kind];
    return { text: letter.text, tone: letter.tone, label: t(letter.label) };
  }
  const count = closedFolder ? changes.countInside(path) : 0;
  return count === 0 ? undefined : { text: String(count), tone: 'muted', label: t('files.changedInside', { count }) };
};

/** A listing with what git adds to it, in the tree's order; the listing itself when git adds nothing. */
export const withChanges = (listing: ReadonlyArray<FolderEntry>, dir: string, changes: Changes): ReadonlyArray<FolderEntry> => {
  const names = new Set(listing.map((entry) => entry.name));
  const missing = changes.childrenOf(dir).filter((entry) => !names.has(entry.name));
  return missing.length === 0 ? listing : [...listing, ...missing].sort(byFoldersThenName);
};

interface Branch {
  readonly folders: Map<string, Branch>;
  readonly files: Set<string>;
}

const branch = (): Branch => ({ folders: new Map(), files: new Set() });

/**
 * The changed-only tree: every changed path with the folders that lead to it, all open. A changed folder (wholly untracked,
 * or a submodule) is a row of its own with nothing under it. A folder whose only content is one folder is one row.
 */
export const changedOnlyTree = (changes: Changes, t: Translate): ReadonlyArray<TreeNode> => {
  const root = branch();
  for (const entry of changes.entries) {
    const parts = entry.path.split('/');
    let at = root;
    for (const part of parts.slice(0, -1)) {
      const next = at.folders.get(part) ?? branch();
      at.folders.set(part, next);
      at = next;
    }
    const last = parts[parts.length - 1]!;
    if (entry.folder) at.folders.set(last, at.folders.get(last) ?? branch());
    else at.files.add(last);
  }
  const nodesOf = (at: Branch, dir: string): ReadonlyArray<TreeNode> => {
    const items = [
      ...[...at.folders.keys()].map((name) => ({ name, kind: 'folder' })),
      ...[...at.files].map((name) => ({ name, kind: 'file' })),
    ].sort(byFoldersThenName);
    return items.map((item): TreeNode => {
      const path = join(dir, item.name);
      if (item.kind === 'file') {
        return { id: path, label: item.name, kind: 'file', ...marks(changes, path, t) };
      }
      let label = item.name;
      let last = path;
      let inner = at.folders.get(item.name)!;
      // A folder holding one folder and nothing else, itself unchanged, joins it in one row.
      while (inner.files.size === 0 && inner.folders.size === 1 && changes.kindOf(last) === undefined) {
        const [[name, next]] = [...inner.folders];
        label = `${label}/${name}`;
        last = join(last, name);
        inner = next;
      }
      const children = nodesOf(inner, last);
      const flag = flagOf(changes, last, false, t);
      return { id: path, label, kind: 'folder', expanded: true, ...(children.length > 0 ? { children } : {}), ...(flag ? { flag } : {}) };
    });
  };
  return nodesOf(root, '');
};

/** The mark of a file row, and whether it is struck through (a deleted file). */
export const marks = (changes: Changes, path: string, t: Translate): Pick<TreeNode, 'flag' | 'struck'> => {
  const flag = flagOf(changes, path, false, t);
  return { ...(flag ? { flag } : {}), ...(changes.kindOf(path) === 'deleted' ? { struck: true } : {}) };
};
