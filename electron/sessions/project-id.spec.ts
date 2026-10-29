import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeCwd, projectIdOfCwd } from './project-id';

describe('projectIdOfCwd', () => {
  it('is stable for the same directory however it is written', () => {
    const dir = path.resolve('work', 'app');
    expect(projectIdOfCwd(`${dir}${path.sep}`)).toBe(projectIdOfCwd(dir));
    expect(projectIdOfCwd(dir.replaceAll('\\', '/'))).toBe(projectIdOfCwd(dir));
  });

  it('differs between directories', () => {
    expect(projectIdOfCwd(path.resolve('work', 'a'))).not.toBe(projectIdOfCwd(path.resolve('work', 'b')));
  });

  it('is 16 hex characters', () => {
    expect(projectIdOfCwd(path.resolve('work'))).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('normalizeCwd', () => {
  it('uses forward slashes and no trailing slash', () => {
    expect(normalizeCwd(`${path.resolve('work')}${path.sep}`)).not.toMatch(/[\\/]$/);
    expect(normalizeCwd(path.resolve('work'))).not.toContain('\\');
  });
});
