import { languageOf } from './file-language';

/** The language name and highlight.js grammar a file name gets. */
const of = (fileName: string) => {
  const language = languageOf(fileName);
  return `${language.name} / ${language.hljsId ?? 'none'}`;
};

describe('The language of a file', () => {
  it('comes from its extension', () => {
    expect(of('main.ts')).toBe('TypeScript / typescript');
    expect(of('styles.css')).toBe('CSS / css');
    expect(of('build.gradle')).toBe('Groovy / groovy');
    expect(of('deploy.ps1')).toBe('PowerShell / powershell');
    expect(of('app.properties')).toBe('Properties / properties');
  });

  it('comes from its exact name before any extension', () => {
    expect(of('Dockerfile')).toBe('Dockerfile / dockerfile');
    expect(of('Makefile')).toBe('Makefile / makefile');
    expect(of('.env')).toBe('Env / ini');
    expect(of('.gitconfig')).toBe('INI / ini');
  });

  it('takes the longest extension that has a row', () => {
    expect(of('lib.dom.d.ts')).toBe('TypeScript declarations / typescript');
    expect(of('tabs.component.html')).toBe('Angular HTML / xml');
    expect(of('index.html')).toBe('HTML / xml');
    expect(of('archive.tar.ts')).toBe('TypeScript / typescript');
  });

  it('ignores case', () => {
    expect(of('README.MD')).toBe('Markdown / markdown');
    expect(of('dockerfile')).toBe('Dockerfile / dockerfile');
    expect(of('Main.JAVA')).toBe('Java / java');
  });

  it('sends the kinds with no grammar of their own to the nearest one', () => {
    expect(of('Cargo.toml')).toBe('TOML / ini');
    expect(of('prod.env')).toBe('Env / ini');
    expect(of('tsconfig.jsonc')).toBe('JSON with Comments / json');
    expect(of('server.mts')).toBe('TypeScript / typescript');
    expect(of('server.cts')).toBe('TypeScript / typescript');
    expect(of('logo.svg')).toBe('SVG / xml');
    expect(of('page.mdx')).toBe('Markdown / markdown');
  });

  it('is plain text for a name with no row, whatever the file holds', () => {
    expect(of('notes.txt')).toBe('Plain text / none');
    expect(of('LICENSE')).toBe('Plain text / none');
    expect(of('main.zig')).toBe('Plain text / none');
    // The extension alone is not a name: a file called `ts` is not TypeScript.
    expect(of('ts')).toBe('Plain text / none');
  });

  it('says which files have an outline of symbols', () => {
    expect(languageOf('a.ts').symbols).toBe('typescript');
    expect(languageOf('a.tsx').symbols).toBe('tsx');
    expect(languageOf('a.js').symbols).toBe('javascript');
    expect(languageOf('a.jsx').symbols).toBe('jsx');
    expect(languageOf('A.java').symbols).toBe('java');
    expect(languageOf('a.py').symbols).toBeUndefined();
  });
});
