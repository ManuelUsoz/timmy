/** The highlight.js grammars the reader ships, one lazy chunk each (`syntax-colours.ts` holds the chunks). */
export type HljsId =
  | 'bash'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'css'
  | 'diff'
  | 'dockerfile'
  | 'go'
  | 'graphql'
  | 'groovy'
  | 'ini'
  | 'java'
  | 'javascript'
  | 'json'
  | 'kotlin'
  | 'less'
  | 'lua'
  | 'makefile'
  | 'markdown'
  | 'objectivec'
  | 'perl'
  | 'php'
  | 'powershell'
  | 'properties'
  | 'python'
  | 'r'
  | 'ruby'
  | 'rust'
  | 'scss'
  | 'sql'
  | 'swift'
  | 'typescript'
  | 'vbnet'
  | 'wasm'
  | 'xml'
  | 'yaml';

/** The grammars that give an outline of symbols, for the Breadcrumb. */
export type SymbolsId = 'typescript' | 'tsx' | 'javascript' | 'jsx' | 'java';

/**
 * How the reader renders one kind of file. `match` holds exact file names and extensions (those that start with a
 * dot; such a row also matches a file named exactly so, like `.env`). `hljsId` is absent for plain text.
 */
export interface FileLanguage {
  readonly match: ReadonlyArray<string>;
  /** The name the status bar shows. */
  readonly name: string;
  readonly hljsId?: HljsId;
  readonly symbols?: SymbolsId;
}

/** What a file with no row is. */
export const PLAIN_TEXT: FileLanguage = { match: [], name: 'Plain text' };

/** The renderer table. A new kind of file is a row here (and a chunk in `syntax-colours.ts` when its grammar is new). */
export const FILE_LANGUAGES: ReadonlyArray<FileLanguage> = [
  { match: ['.ts', '.mts', '.cts'], name: 'TypeScript', hljsId: 'typescript', symbols: 'typescript' },
  { match: ['.d.ts', '.d.mts', '.d.cts'], name: 'TypeScript declarations', hljsId: 'typescript', symbols: 'typescript' },
  { match: ['.tsx'], name: 'TypeScript JSX', hljsId: 'typescript', symbols: 'tsx' },
  { match: ['.js', '.mjs', '.cjs'], name: 'JavaScript', hljsId: 'javascript', symbols: 'javascript' },
  { match: ['.jsx'], name: 'JavaScript JSX', hljsId: 'javascript', symbols: 'jsx' },
  { match: ['.json', '.webmanifest', '.babelrc', '.eslintrc', '.prettierrc'], name: 'JSON', hljsId: 'json' },
  { match: ['.jsonc', '.json5'], name: 'JSON with Comments', hljsId: 'json' },
  { match: ['.html', '.htm'], name: 'HTML', hljsId: 'xml' },
  { match: ['.component.html'], name: 'Angular HTML', hljsId: 'xml' },
  { match: ['.xml', '.xsd', '.xsl', '.xslt', '.plist', '.csproj', '.props', '.targets', '.xaml'], name: 'XML', hljsId: 'xml' },
  { match: ['.svg'], name: 'SVG', hljsId: 'xml' },
  { match: ['.css'], name: 'CSS', hljsId: 'css' },
  { match: ['.scss'], name: 'SCSS', hljsId: 'scss' },
  { match: ['.less'], name: 'Less', hljsId: 'less' },
  { match: ['.md', '.markdown', '.mdx'], name: 'Markdown', hljsId: 'markdown' },
  { match: ['.yaml', '.yml'], name: 'YAML', hljsId: 'yaml' },
  { match: ['.toml'], name: 'TOML', hljsId: 'ini' },
  { match: ['.ini', '.cfg', '.conf', '.editorconfig', '.gitconfig', '.npmrc'], name: 'INI', hljsId: 'ini' },
  { match: ['.env', '.env.local', '.env.development', '.env.production', '.env.test', '.env.example'], name: 'Env', hljsId: 'ini' },
  { match: ['.properties'], name: 'Properties', hljsId: 'properties' },
  { match: ['.sh', '.bash', '.zsh', '.bashrc', '.zshrc', '.bash_profile', '.profile'], name: 'Shell', hljsId: 'bash' },
  { match: ['.ps1', '.psm1', '.psd1'], name: 'PowerShell', hljsId: 'powershell' },
  { match: ['.py', '.pyi', '.pyw'], name: 'Python', hljsId: 'python' },
  { match: ['.rb', '.rake', '.gemspec', 'Gemfile', 'Rakefile'], name: 'Ruby', hljsId: 'ruby' },
  { match: ['.rs'], name: 'Rust', hljsId: 'rust' },
  { match: ['.go'], name: 'Go', hljsId: 'go' },
  { match: ['.java'], name: 'Java', hljsId: 'java', symbols: 'java' },
  { match: ['.kt', '.kts'], name: 'Kotlin', hljsId: 'kotlin' },
  { match: ['.groovy', '.gradle', 'Jenkinsfile'], name: 'Groovy', hljsId: 'groovy' },
  { match: ['.c', '.h'], name: 'C', hljsId: 'c' },
  { match: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'], name: 'C++', hljsId: 'cpp' },
  { match: ['.cs'], name: 'C#', hljsId: 'csharp' },
  { match: ['.m', '.mm'], name: 'Objective-C', hljsId: 'objectivec' },
  { match: ['.swift'], name: 'Swift', hljsId: 'swift' },
  { match: ['.php'], name: 'PHP', hljsId: 'php' },
  { match: ['.pl', '.pm'], name: 'Perl', hljsId: 'perl' },
  { match: ['.lua'], name: 'Lua', hljsId: 'lua' },
  { match: ['.r'], name: 'R', hljsId: 'r' },
  { match: ['.sql'], name: 'SQL', hljsId: 'sql' },
  { match: ['.graphql', '.gql'], name: 'GraphQL', hljsId: 'graphql' },
  { match: ['.diff', '.patch'], name: 'Diff', hljsId: 'diff' },
  { match: ['Makefile', 'GNUmakefile', '.mk'], name: 'Makefile', hljsId: 'makefile' },
  { match: ['Dockerfile', 'Containerfile', '.dockerfile'], name: 'Dockerfile', hljsId: 'dockerfile' },
  { match: ['.vb'], name: 'Visual Basic', hljsId: 'vbnet' },
  { match: ['.wat', '.wast'], name: 'WebAssembly', hljsId: 'wasm' },
];

/** Every name and extension of the table, lower case, to its row. */
const rows: ReadonlyMap<string, FileLanguage> = new Map(FILE_LANGUAGES.flatMap((language) => language.match.map((match) => [match.toLowerCase(), language] as const)));

/**
 * The language of a file, by its name alone: its exact name, then its longest extension with a row, then plain text.
 * Case does not count. The content is never looked at and the user cannot override it.
 */
export const languageOf = (fileName: string): FileLanguage => {
  const name = fileName.toLowerCase();
  const exact = rows.get(name);
  if (exact !== undefined) return exact;
  // Each dot after the first character starts a candidate extension; the first one found is the longest.
  for (let dot = name.indexOf('.', 1); dot !== -1; dot = name.indexOf('.', dot + 1)) {
    const language = rows.get(name.slice(dot));
    if (language !== undefined) return language;
  }
  return PLAIN_TEXT;
};
