import path from 'node:path';
import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Option } from 'effect';
import { layerFolderPickerTest } from './folder-picker';
import { projectIdOfCwd } from './project-id';
import { layerProjectFoldersTest, type FakeFolders } from './project-folders';
import { layerProjectStore, ProjectStore } from './project-store';
import { layerProjectsService, ProjectsService } from './projects-service';

const at = (...parts: string[]) => path.resolve('/disk', ...parts);

/** A real in-memory repo, a pretend disk, and a picker that answers `picked`. */
const makeLayer = (fake: FakeFolders, picked: Option.Option<string> = Option.none()) =>
  layerProjectsService.pipe(
    Layer.provide(layerProjectFoldersTest(fake)),
    Layer.provide(layerFolderPickerTest(picked)),
    Layer.provideMerge(layerProjectStore(':memory:')),
  );

describe('ProjectsService', () => {
  describe('adding a folder', () => {
    const fake = { folders: { [at('app')]: 'main', [at('plain')]: null } };

    it.effect('adds a git folder under the name of the folder, or under the name the user typed', () =>
      Effect.gen(function* () {
        const projects = yield* ProjectsService;
        const first = yield* projects.add(at('app'));
        expect(first).toMatchObject({ cwd: at('app'), name: 'app', lastUsedAt: null });
        yield* projects.remove(first.projectId);
        const again = yield* projects.add(at('app'), '  Mi app ');
        expect(again.name).toBe('Mi app');
        expect((yield* projects.list).map((p) => p.name)).toEqual(['Mi app']);
      }).pipe(Effect.provide(makeLayer(fake))),
    );

    it.effect('rejects a folder that is already in the list, naming the project that has it', () =>
      Effect.gen(function* () {
        const projects = yield* ProjectsService;
        yield* projects.add(at('app'), 'timmy');
        const error = yield* projects.add(at('app')).pipe(Effect.flip);
        expect(error.reason).toBe('AlreadyAdded');
        expect(error.detail).toContain('timmy');
        expect((yield* projects.inspectFolder(at('app'))).existingName).toBe('timmy');
      }).pipe(Effect.provide(makeLayer(fake))),
    );

    it.effect('rejects a folder that is not a git repository, and one that does not exist', () =>
      Effect.gen(function* () {
        const projects = yield* ProjectsService;
        expect((yield* projects.add(at('plain')).pipe(Effect.flip)).reason).toBe('NotAGitRepository');
        expect((yield* projects.add(at('nowhere')).pipe(Effect.flip)).reason).toBe('FolderNotFound');
        expect(yield* projects.list).toEqual([]);
      }).pipe(Effect.provide(makeLayer(fake))),
    );
  });

  describe('inspecting a folder', () => {
    it.effect('reports the branch of a repository and none for a plain folder', () =>
      Effect.gen(function* () {
        const projects = yield* ProjectsService;
        expect(yield* projects.inspectFolder(at('app'))).toEqual({ path: at('app'), branch: 'main', existingName: null });
        expect(yield* projects.inspectFolder(at('plain'))).toEqual({ path: at('plain'), branch: null, existingName: null });
      }).pipe(Effect.provide(makeLayer({ folders: { [at('app')]: 'main', [at('plain')]: null } }))),
    );
  });

  describe('initialising git', () => {
    it.effect('turns a plain folder into a repository, and leaves a repository alone', () =>
      Effect.gen(function* () {
        const projects = yield* ProjectsService;
        expect((yield* projects.initGit(at('plain'))).branch).toBe('master');
        expect((yield* projects.initGit(at('app'))).branch).toBe('main');
        expect((yield* projects.add(at('plain'))).cwd).toBe(at('plain'));
      }).pipe(Effect.provide(makeLayer({ folders: { [at('app')]: 'main', [at('plain')]: null } }))),
    );

    it.effect('says so when git is not installed, and changes nothing', () =>
      Effect.gen(function* () {
        const projects = yield* ProjectsService;
        expect((yield* projects.initGit(at('plain')).pipe(Effect.flip)).reason).toBe('GitUnavailable');
        expect((yield* projects.inspectFolder(at('plain'))).branch).toBeNull();
      }).pipe(Effect.provide(makeLayer({ folders: { [at('plain')]: null }, gitMissing: true }))),
    );
  });

  describe('removing a project', () => {
    it.effect('takes it out of the list, and it gets the same id when the folder comes back', () =>
      Effect.gen(function* () {
        const projects = yield* ProjectsService;
        const { projectId } = yield* projects.add(at('app'));
        yield* projects.remove(projectId);
        expect(yield* projects.list).toEqual([]);
        const back = yield* projects.add(at('app'));
        expect(back.projectId).toBe(projectId);
      }).pipe(Effect.provide(makeLayer({ folders: { [at('app')]: 'main' } }))),
    );

    it.effect('fails for a project that is not in the list', () =>
      Effect.gen(function* () {
        const projects = yield* ProjectsService;
        const { projectId } = yield* projects.add(at('app'));
        yield* projects.remove(projectId);
        expect((yield* projects.remove(projectId).pipe(Effect.flip)).reason).toBe('ProjectNotFound');
      }).pipe(Effect.provide(makeLayer({ folders: { [at('app')]: 'main' } }))),
    );
  });

  describe('checking the folder of a project', () => {
    it.effect('is present while the folder is on disk', () =>
      Effect.gen(function* () {
        const projects = yield* ProjectsService;
        const { projectId } = yield* projects.add(at('app'));
        expect(yield* projects.checkFolder(projectId)).toBe('Present');
      }).pipe(Effect.provide(makeLayer({ folders: { [at('app')]: 'main' } }))),
    );

    it.effect('is missing once the folder is gone, and the project stays in the list', () =>
      Effect.gen(function* () {
        const projects = yield* ProjectsService;
        // Added straight to the store: the pretend disk never had this folder, as if it was moved afterwards.
        const { projectId } = yield* ProjectStore.use((store) => store.add(at('moved')));
        expect(yield* projects.checkFolder(projectId)).toBe('Missing');
        expect((yield* projects.list).map((p) => p.projectId)).toEqual([projectId]);
      }).pipe(Effect.provide(makeLayer({ folders: {} }))),
    );

    it.effect('fails for a project that is not in the list', () =>
      Effect.gen(function* () {
        const projects = yield* ProjectsService;
        const projectId = projectIdOfCwd(at('app'));
        expect((yield* projects.checkFolder(projectId).pipe(Effect.flip)).reason).toBe('ProjectNotFound');
      }).pipe(Effect.provide(makeLayer({ folders: { [at('app')]: 'main' } }))),
    );
  });

  describe('remembering the last project used', () => {
    it.effect('stamps the project when it is opened', () =>
      Effect.gen(function* () {
        const projects = yield* ProjectsService;
        const { projectId } = yield* projects.add(at('app'));
        yield* projects.markUsed(projectId);
        const [listed] = yield* projects.list;
        expect(listed?.lastUsedAt).not.toBeNull();
      }).pipe(Effect.provide(makeLayer({ folders: { [at('app')]: 'main' } }))),
    );
  });

  describe('picking a folder', () => {
    it.effect('answers with the folder the user chose', () =>
      Effect.gen(function* () {
        expect(yield* (yield* ProjectsService).pickFolder).toEqual(Option.some(at('app')));
      }).pipe(Effect.provide(makeLayer({ folders: {} }, Option.some(at('app'))))),
    );

    it.effect('answers with none when the user cancels', () =>
      Effect.gen(function* () {
        expect(Option.isNone(yield* (yield* ProjectsService).pickFolder)).toBe(true);
      }).pipe(Effect.provide(makeLayer({ folders: {} }))),
    );
  });
});
