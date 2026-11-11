/** What every heading id of rendered Markdown starts with; an `#anchor` link finds its heading with or without it. */
export const HEADING_ID_PREFIX = 'user-content-';

/** What a link or image in rendered Markdown resolves to. */
export type ResolvedTarget =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'folder'; readonly path: string }
  | { readonly kind: 'anchor'; readonly id: string }
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'inert'; readonly reason: string };

const EXTERNAL_PROTOCOL = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Decides what a Markdown link `target` means, relative to the README's path `readmePath` inside the Project.
 * Paths use `/`; a leading `/` is the Project root. The answer is pure: it classifies, it does not read disk or open UI.
 */
export const resolveInProject = (readmePath: string, target: string): ResolvedTarget => {
  if (target.startsWith('#')) {
    const id = target.slice(1);
    return id === '' ? { kind: 'inert', reason: 'empty-anchor' } : { kind: 'anchor', id };
  }

  if (EXTERNAL_PROTOCOL.test(target)) {
    if (target.startsWith('https:')) return { kind: 'external', url: target };
    return { kind: 'inert', reason: 'unsupported-scheme' };
  }

  return resolveRelative(readmePath, target);
};

/** Decides what a Markdown image `target` means. Remote images are inert (shown as alt text only). */
export const resolveImage = (readmePath: string, target: string): ResolvedTarget => {
  if (EXTERNAL_PROTOCOL.test(target)) return { kind: 'inert', reason: 'remote-image' };
  return resolveRelative(readmePath, target);
};

const resolveRelative = (readmePath: string, rawTarget: string): ResolvedTarget => {
  if (rawTarget.startsWith('//')) return { kind: 'inert', reason: 'unsupported-scheme' };
  const target = decode(rawTarget.replace(/[?#].*$/, ''));
  if (target === '') return { kind: 'inert', reason: 'empty-target' };
  const readmeDir = readmePath.includes('/') ? readmePath.slice(0, readmePath.lastIndexOf('/')) : '';
  const raw = target.startsWith('/') ? target.slice(1) : joinPath(readmeDir, target);
  const normalized = normalizePath(raw);

  if (normalized === '' || normalized.startsWith('../')) return { kind: 'inert', reason: 'outside-project' };
  if (normalized.includes('/../')) return { kind: 'inert', reason: 'outside-project' };

  const isFolder = target.endsWith('/') || normalized.endsWith('/');
  if (isFolder) {
    const folder = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
    return folder === '' ? { kind: 'inert', reason: 'project-root-folder' } : { kind: 'folder', path: folder };
  }

  return { kind: 'file', path: normalized };
};

/** Joins two `/`-separated paths. */
const joinPath = (left: string, right: string): string => {
  if (left === '') return right;
  if (right === '') return left;
  return `${left}/${right}`;
};

/** Normalizes `.` and `..` segments of a `/`-separated path without touching leading `..`. */
const normalizePath = (value: string): string => {
  const parts = value.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return '../' + value;
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join('/');
};

/** A destination as the file is named: `%20` is a space. One that does not decode is left as written. */
const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
