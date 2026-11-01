import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Context, Effect, Layer, Option, Ref } from 'effect';
import { ProjectsError } from '../../src/shared/projects/projects-error.model';

/** What project management needs from the disk and from git. Everything here is a real-world boundary. */
export class ProjectFolders extends Context.Service<
  ProjectFolders,
  {
    /** Whether `folder` is a directory that exists. */
    readonly exists: (folder: string) => Effect.Effect<boolean>;
    /** The branch checked out in the git repository at `folder`; `None` when it is not one. */
    readonly gitBranch: (folder: string) => Effect.Effect<Option.Option<string>>;
    /** `git init` in `folder`, without an initial commit. */
    readonly initGit: (folder: string) => Effect.Effect<void, ProjectsError>;
  }
>()('projects/ProjectFolders') {}

const isDirectory = (target: string): Effect.Effect<boolean> =>
  Effect.tryPromise(() => stat(target)).pipe(
    Effect.map((info) => info.isDirectory()),
    Effect.orElseSucceed(() => false),
  );

const readText = (file: string): Effect.Effect<Option.Option<string>> =>
  Effect.tryPromise(() => readFile(file, 'utf8')).pipe(
    Effect.map(Option.some),
    Effect.orElseSucceed(() => Option.none()),
  );

/** The `HEAD` file of the repository whose `.git` is `dotGit`: inside the folder, or where a worktree's file points. */
const headFile = (folder: string, dotGit: string): Effect.Effect<Option.Option<string>> =>
  isDirectory(dotGit).pipe(
    Effect.flatMap((directory) =>
      directory
        ? Effect.succeed(Option.some(path.join(dotGit, 'HEAD')))
        : readText(dotGit).pipe(
            Effect.map((text) =>
              Option.flatMap(text, (content) => {
                const match = /^gitdir:\s*(.+?)\s*$/m.exec(content);
                return match?.[1] === undefined ? Option.none() : Option.some(path.join(path.resolve(folder, match[1]), 'HEAD'));
              }),
            ),
          ),
    ),
  );

/** `ref: refs/heads/main` is the branch `main`; a bare hash is a detached HEAD. */
export const branchOfHead = (head: string): string => {
  const ref = /^ref:\s*refs\/heads\/(.+?)\s*$/.exec(head);
  return ref?.[1] ?? head.trim().slice(0, 7);
};

const gitFailure = (folder: string, error: unknown, stderr: string): ProjectsError => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT') {
    return new ProjectsError({ reason: 'GitUnavailable', detail: 'git is not installed, or it is not on the PATH' });
  }
  const text = stderr.trim();
  return new ProjectsError({ reason: 'GitInitFailed', detail: text === '' ? `git init failed in ${folder}` : text });
};

const runGitInit = (folder: string): Effect.Effect<void, ProjectsError> =>
  Effect.callback<void, ProjectsError>((resume) => {
    execFile('git', ['init'], { cwd: folder, windowsHide: true }, (error, _stdout, stderr) => {
      resume(error === null ? Effect.void : Effect.fail(gitFailure(folder, error, stderr)));
    });
  });

/** The real disk and the real `git` executable. */
export const layerProjectFolders: Layer.Layer<ProjectFolders> = Layer.succeed(ProjectFolders, {
  exists: isDirectory,
  gitBranch: Effect.fn('ProjectFolders.gitBranch')(function* (folder) {
    const head = yield* headFile(folder, path.join(folder, '.git'));
    if (Option.isNone(head)) return Option.none<string>();
    return Option.map(yield* readText(head.value), branchOfHead);
  }),
  initGit: Effect.fn('ProjectFolders.initGit')(function* (folder) {
    yield* runGitInit(folder);
  }),
});

export interface FakeFolders {
  /** Folders on the fake disk: `null` is a folder that is not a git repository, a string is its branch. */
  readonly folders: Readonly<Record<string, string | null>>;
  /** Pretend git is not installed. */
  readonly gitMissing?: boolean;
}

/** A disk in memory, for tests of the layers above it. `git init` puts the branch `master` on a folder. */
export const layerProjectFoldersTest = (fake: FakeFolders): Layer.Layer<ProjectFolders> =>
  Layer.effect(
    ProjectFolders,
    Effect.gen(function* () {
      const disk = yield* Ref.make(new Map(Object.entries(fake.folders).map(([folder, branch]) => [path.resolve(folder), branch])));
      return ProjectFolders.of({
        exists: (folder) => Effect.map(Ref.get(disk), (folders) => folders.has(path.resolve(folder))),
        gitBranch: (folder) =>
          Effect.map(Ref.get(disk), (folders) => Option.fromNullishOr(folders.get(path.resolve(folder)))),
        initGit: (folder) =>
          fake.gitMissing === true
            ? Effect.fail(new ProjectsError({ reason: 'GitUnavailable', detail: 'git is not installed' }))
            : Ref.update(disk, (folders) => new Map(folders).set(path.resolve(folder), 'master')),
      });
    }),
  );
