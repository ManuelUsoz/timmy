import type { UrlSegment } from '@angular/router';
import { projectsMatcher } from './workspace.routes';

const match = (url: string) => {
  const segments = url.split('/').filter(Boolean).map((path) => ({ path, parameters: {} }) as unknown as UrlSegment);
  const result = projectsMatcher(segments, null as never, null as never);
  return result === null ? null : Object.fromEntries(Object.entries(result.posParams ?? {}).map(([key, value]) => [key, value.path]));
};

describe('projectsMatcher', () => {
  it('matches the three shapes of Projects that existed before terminals', () => {
    expect(match('projects')).toEqual({});
    expect(match('projects/p1')).toEqual({ projectId: 'p1' });
    expect(match('projects/p1/sessions/s1')).toEqual({ projectId: 'p1', sessionId: 's1' });
  });

  it('matches a terminal of a project', () => {
    expect(match('projects/p1/terminals/t1')).toEqual({ projectId: 'p1', terminalId: 't1' });
  });

  it('does not match other areas, nor unknown kinds of child', () => {
    expect(match('history')).toBeNull();
    expect(match('projects/p1/files/f1')).toBeNull();
    expect(match('projects/p1/terminals')).toBeNull();
    expect(match('projects/p1/terminals/t1/extra')).toBeNull();
  });
});
