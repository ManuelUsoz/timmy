import { createHash } from 'node:crypto';
import path from 'node:path';
import { ProjectId } from '../../src/shared/sessions/sessions.model';

/** Same directory, same string: separators unified, no trailing slash, case folded on Windows. */
export const normalizeCwd = (cwd: string): string => {
  const unified = path.resolve(cwd).replaceAll('\\', '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? unified.toLowerCase() : unified;
};

/**
 * The project id of a directory while projects are implicit. Only `ProjectResolver`
 * calls this, so a real project entity can replace it without touching callers.
 */
export const projectIdOfCwd = (cwd: string): ProjectId =>
  ProjectId.make(createHash('sha256').update(normalizeCwd(cwd)).digest('hex').slice(0, 16));
