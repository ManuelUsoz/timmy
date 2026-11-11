import { resolveImage, resolveInProject } from './resolve-in-project';

describe('resolveInProject', () => {
  const from = 'docs/guide/README.md';

  it('resolves a relative link against the README folder', () => {
    expect(resolveInProject(from, 'intro.md')).toEqual({ kind: 'file', path: 'docs/guide/intro.md' });
    expect(resolveInProject(from, './a/b.ts')).toEqual({ kind: 'file', path: 'docs/guide/a/b.ts' });
    expect(resolveInProject(from, '../top.md')).toEqual({ kind: 'file', path: 'docs/top.md' });
    expect(resolveInProject('README.md', 'src/main.ts')).toEqual({ kind: 'file', path: 'src/main.ts' });
  });

  it('takes a leading slash as the Project root and decodes the name', () => {
    expect(resolveInProject(from, '/src/a%20b.ts')).toEqual({ kind: 'file', path: 'src/a b.ts' });
  });

  it('drops a query or a fragment from a link to a file', () => {
    expect(resolveInProject(from, 'intro.md#install')).toEqual({ kind: 'file', path: 'docs/guide/intro.md' });
  });

  it('takes a trailing slash as a folder', () => {
    expect(resolveInProject(from, '../')).toEqual({ kind: 'folder', path: 'docs' });
    expect(resolveInProject(from, 'img/')).toEqual({ kind: 'folder', path: 'docs/guide/img' });
  });

  it('takes #anchor as the document itself', () => {
    expect(resolveInProject(from, '#install')).toEqual({ kind: 'anchor', id: 'install' });
  });

  it('opens https outside and nothing else with a scheme', () => {
    expect(resolveInProject(from, 'https://example.com/x')).toEqual({ kind: 'external', url: 'https://example.com/x' });
    for (const target of ['http://example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'mailto:a@b.c', 'data:text/html,x', '//evil.example/x']) {
      expect(resolveInProject(from, target).kind, target).toBe('inert');
    }
  });

  it('refuses a path that leaves the Project', () => {
    expect(resolveInProject(from, '../../../outside.md').kind).toBe('inert');
    expect(resolveInProject('README.md', '../outside.md').kind).toBe('inert');
    expect(resolveInProject(from, '/../outside.md').kind).toBe('inert');
  });
});

describe('resolveImage', () => {
  it('resolves a relative image and takes a leading slash as the Project root', () => {
    expect(resolveImage('docs/README.md', 'img/a.png')).toEqual({ kind: 'file', path: 'docs/img/a.png' });
    expect(resolveImage('docs/README.md', '/assets/a.png')).toEqual({ kind: 'file', path: 'assets/a.png' });
  });

  it('never resolves a remote image or a file: URL', () => {
    for (const src of ['https://example.com/a.png', 'http://example.com/a.png', 'file:///C:/a.png', 'data:image/png;base64,AAAA']) {
      expect(resolveImage('README.md', src).kind, src).toBe('inert');
    }
  });
});
