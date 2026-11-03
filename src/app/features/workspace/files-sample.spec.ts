import { sampleFiles } from './files-sample';

describe('sampleFiles', () => {
  it('has the design nodes: open folders, a dimmed node_modules and a modified file', () => {
    const tree = sampleFiles('Modificado');
    expect(tree.map((node) => node.label)).toEqual(['src', 'electron', 'node_modules', 'CLAUDE.md', 'package.json']);
    expect(tree.find((node) => node.label === 'node_modules')?.dimmed).toBe(true);
    expect(tree.find((node) => node.label === 'package.json')?.flag).toEqual({ text: 'M', label: 'Modificado' });
  });

  it('gives every node a unique id', () => {
    const ids: string[] = [];
    const walk = (nodes: ReturnType<typeof sampleFiles>): void => nodes.forEach((n) => (ids.push(n.id), walk(n.children ?? [])));
    walk(sampleFiles('M'));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
