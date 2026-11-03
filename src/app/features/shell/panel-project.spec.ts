import { describe, expect, it } from 'vitest';
import type { Project } from '../../../shared/projects/projects.model';
import { ProjectId } from '../../../shared/projects/projects.model';
import { panelProject } from './panel-project';

const project = (id: string, lastUsedAt: number | null): Project => ({ projectId: ProjectId.make(id), name: id, cwd: `/work/${id}`, createdAt: 0, lastUsedAt });

describe('panelProject', () => {
  it('is the Project used last', () => {
    expect(panelProject([project('a', 10), project('b', 30), project('c', 20)])?.projectId).toBe('b');
  });

  it('is the first Project when none was ever used', () => {
    expect(panelProject([project('a', null), project('b', null)])?.projectId).toBe('a');
  });

  it('prefers a used Project to one that never was', () => {
    expect(panelProject([project('a', null), project('b', 5)])?.projectId).toBe('b');
  });

  it('is nothing when there are no Projects', () => {
    expect(panelProject([])).toBeUndefined();
  });
});
