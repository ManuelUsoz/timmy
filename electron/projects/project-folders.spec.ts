import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { branchOfHead, layerProjectFolders, ProjectFolders } from './project-folders';

const withFolders = Effect.provide(layerProjectFolders);

describe('branchOfHead', () => {
  it('reads the branch of a symbolic HEAD, slashes included', () => {
    expect(branchOfHead('ref: refs/heads/main\n')).toBe('main');
    expect(branchOfHead('ref: refs/heads/feature/nxy-58\n')).toBe('feature/nxy-58');
  });

  it('shortens the hash of a detached HEAD', () => {
    expect(branchOfHead('0123456789abcdef0123456789abcdef01234567\n')).toBe('0123456');
  });
});

describe('ProjectFolders on the real disk', () => {
  let root = '';
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'timmy-folders-'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.effect('tells a directory from a file and from nothing', () =>
    Effect.gen(function* () {
      const folders = yield* ProjectFolders;
      yield* Effect.promise(() => writeFile(path.join(root, 'file.txt'), 'x'));
      expect(yield* folders.exists(root)).toBe(true);
      expect(yield* folders.exists(path.join(root, 'file.txt'))).toBe(false);
      expect(yield* folders.exists(path.join(root, 'nothing'))).toBe(false);
    }).pipe(withFolders),
  );

  it.effect('reads the branch from .git/HEAD, and from the .git file of a worktree', () =>
    Effect.gen(function* () {
      const folders = yield* ProjectFolders;
      const repo = path.join(root, 'repo');
      const worktree = path.join(root, 'worktree');
      yield* Effect.promise(async () => {
        await mkdir(path.join(repo, '.git', 'worktrees', 'wt'), { recursive: true });
        await writeFile(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
        await writeFile(path.join(repo, '.git', 'worktrees', 'wt', 'HEAD'), 'ref: refs/heads/feature\n');
        await mkdir(worktree, { recursive: true });
        await writeFile(path.join(worktree, '.git'), `gitdir: ${path.join(repo, '.git', 'worktrees', 'wt')}\n`);
      });
      expect(yield* folders.gitBranch(repo)).toEqual(Option.some('main'));
      expect(yield* folders.gitBranch(worktree)).toEqual(Option.some('feature'));
    }).pipe(withFolders),
  );

  it.effect('finds no branch in a folder without .git', () =>
    Effect.gen(function* () {
      const plain = path.join(root, 'plain');
      yield* Effect.promise(() => mkdir(plain, { recursive: true }));
      expect(Option.isNone(yield* (yield* ProjectFolders).gitBranch(plain))).toBe(true);
    }).pipe(withFolders),
  );

  it.effect('git init makes a repository with no commit, and a branch can be read from it', () =>
    Effect.gen(function* () {
      const folders = yield* ProjectFolders;
      const fresh = path.join(root, 'fresh');
      yield* Effect.promise(() => mkdir(fresh, { recursive: true }));
      yield* folders.initGit(fresh);
      expect(Option.isSome(yield* folders.gitBranch(fresh))).toBe(true);
    }).pipe(withFolders),
  );
});
