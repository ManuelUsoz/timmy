import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';
import type { HljsId } from './file-language';
import type { ColourRange, SyntaxToken } from './source-text';

/** A line longer than this stays plain: a minified line would become thousands of elements. */
export const MAX_COLOURED_LINE = 5000;

/** One lazy chunk per grammar: a static `import()` each, so the bundler emits a file the CSP allows (`script-src 'self'`). */
const grammars: Readonly<Record<HljsId, () => Promise<{ readonly default: LanguageFn }>>> = {
  bash: () => import('highlight.js/lib/languages/bash'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  css: () => import('highlight.js/lib/languages/css'),
  diff: () => import('highlight.js/lib/languages/diff'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  go: () => import('highlight.js/lib/languages/go'),
  graphql: () => import('highlight.js/lib/languages/graphql'),
  groovy: () => import('highlight.js/lib/languages/groovy'),
  ini: () => import('highlight.js/lib/languages/ini'),
  java: () => import('highlight.js/lib/languages/java'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  less: () => import('highlight.js/lib/languages/less'),
  lua: () => import('highlight.js/lib/languages/lua'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  objectivec: () => import('highlight.js/lib/languages/objectivec'),
  perl: () => import('highlight.js/lib/languages/perl'),
  php: () => import('highlight.js/lib/languages/php'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  properties: () => import('highlight.js/lib/languages/properties'),
  python: () => import('highlight.js/lib/languages/python'),
  r: () => import('highlight.js/lib/languages/r'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  scss: () => import('highlight.js/lib/languages/scss'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  vbnet: () => import('highlight.js/lib/languages/vbnet'),
  wasm: () => import('highlight.js/lib/languages/wasm'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
};

/** The grammars a grammar embeds: without them the embedded part (a `<style>`, a `<script>`) stays plain. */
const embedded: Partial<Record<HljsId, ReadonlyArray<HljsId>>> = {
  xml: ['css', 'javascript'],
  markdown: ['xml'],
};

/**
 * The token of each highlight.js scope, by the class it writes (without the `hljs-` prefix). `''` is plain text on
 * purpose (an interpolation inside a string is not string); a scope with no row takes the token of the one around it.
 */
const tokens: Readonly<Record<string, SyntaxToken | ''>> = {
  keyword: 'keyword',
  literal: 'keyword',
  'variable language_': 'keyword',
  'selector-tag': 'keyword',
  name: 'keyword',
  section: 'keyword',
  doctag: 'keyword',
  'template-tag': 'keyword',
  string: 'string',
  regexp: 'string',
  'char escape_': 'string',
  symbol: 'string',
  link: 'string',
  code: 'string',
  addition: 'string',
  number: 'number',
  bullet: 'number',
  deletion: 'number',
  comment: 'comment',
  quote: 'comment',
  title: 'function',
  'title function_': 'function',
  'title function_ invoke__': 'function',
  type: 'type',
  built_in: 'type',
  'title class_': 'type',
  'title class_ inherited__': 'type',
  'selector-class': 'type',
  'selector-id': 'type',
  variable: 'variable',
  'variable constant_': 'variable',
  attr: 'variable',
  attribute: 'variable',
  property: 'variable',
  'template-variable': 'variable',
  'selector-attr': 'variable',
  'selector-pseudo': 'variable',
  punctuation: 'punctuation',
  operator: 'punctuation',
  tag: 'punctuation',
  meta: 'meta',
  subst: '',
  params: '',
  function: '',
  class: '',
  emphasis: '',
  strong: '',
  formula: '',
};

const tokenOf = (scope: string, around: SyntaxToken | ''): SyntaxToken | '' => {
  if (scope.startsWith('language-')) return '';
  return tokens[scope.replace('hljs-', '')] ?? around;
};

/** What highlight.js writes: an opening scope, a closing one, or escaped text. */
const PIECE = /<span class="([^"]*)">|(<\/span>)|([^<]+)/g;

/**
 * The colour ranges of highlight.js's output. Its HTML is its public result, so the ranges are read from it: the scopes
 * are `<span class>` and the text is escaped (`&lt;`), one entity being one character of the source.
 */
const rangesOf = (html: string): ReadonlyArray<ColourRange> => {
  const ranges: Array<ColourRange> = [];
  const stack: Array<SyntaxToken | ''> = [];
  let token: SyntaxToken | '' = '';
  let line = 1;
  let column = 0;
  /** Where the ranges of the current line start in `ranges`, to drop them if the line turns out too long. */
  let lineStart = 0;
  const add = (from: number, to: number) => {
    if (token === '' || from === to) return;
    const last = ranges.at(-1);
    if (last !== undefined && ranges.length > lineStart && last.token === token && last.to === from) ranges[ranges.length - 1] = { ...last, to };
    else ranges.push({ line, from, to, token });
  };
  for (const piece of html.matchAll(PIECE)) {
    if (piece[1] !== undefined) {
      stack.push(token);
      token = tokenOf(piece[1], token);
      continue;
    }
    if (piece[2] !== undefined) {
      token = stack.pop() ?? '';
      continue;
    }
    const text = piece[3];
    let from = column;
    for (let at = 0; at < text.length; at += 1) {
      const char = text[at];
      if (char === '\n') {
        add(from, column);
        if (column > MAX_COLOURED_LINE) ranges.length = lineStart;
        line += 1;
        column = 0;
        from = 0;
        lineStart = ranges.length;
        continue;
      }
      if (char === '&') at = text.indexOf(';', at);
      column += 1;
    }
    add(from, column);
  }
  // A text that ends without a line break leaves its last line unchecked.
  if (column > MAX_COLOURED_LINE) ranges.length = lineStart;
  return ranges;
};

const register = async (hljsId: HljsId): Promise<void> => {
  if (hljs.getLanguage(hljsId) !== undefined) return;
  const grammar = await grammars[hljsId]();
  hljs.registerLanguage(hljsId, grammar.default);
};

/**
 * The colour ranges of a text in a language, ordered by line and offset and never overlapping. It loads the grammar's
 * chunk the first time. It runs in the worker (`syntax-colours.worker.ts`): a large file takes a few hundred ms.
 */
export const colourRanges = async (content: string, hljsId: HljsId): Promise<ReadonlyArray<ColourRange>> => {
  await Promise.all([hljsId, ...(embedded[hljsId] ?? [])].map(register));
  // Line breaks are not part of a line, so CRLF counts like LF.
  const html = hljs.highlight(content.replaceAll('\r\n', '\n'), { language: hljsId, ignoreIllegals: true }).value;
  return rangesOf(html);
};
