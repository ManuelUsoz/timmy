import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';
import type { Token } from 'markdown-it';
import { FILE_LANGUAGES, type HljsId } from './file-language';
import { HEADING_ID_PREFIX, resolveImage, resolveInProject } from './resolve-in-project';

export interface RenderMarkdownOptions {
  /** The Markdown source. */
  readonly content: string;
  /** The file's path inside the Project, used to resolve relative links and images. */
  readonly path: string;
  /** What a Project path is on disk (file or folder), or nothing when it does not exist. */
  readonly kindOf: KindOf;
  /** The tooltip of a link that goes nowhere. */
  readonly inertTitle: string;
}

export interface RenderedMarkdown {
  /** Sanitized HTML ready for the DOM. */
  readonly html: string;
  /** The ids of the headings (github-slugger slugs under `HEADING_ID_PREFIX`), in document order. */
  readonly headings: ReadonlyArray<string>;
}

/** Tags a README is allowed to use after sanitisation. */
const ALLOWED_TAGS = [
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'caption',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'var',
  'wbr',
];

/** Attributes the sanitizer keeps on those tags. */
const ALLOWED_ATTRS = ['alt', 'class', 'id', 'colspan', 'rowspan', 'start', 'title'];

/** One lazy chunk per grammar, so the markdown chunk only loads the grammars a README actually uses. */
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

/** Grammars a grammar embeds; without them the embedded part stays plain. */
const embedded: Partial<Record<HljsId, ReadonlyArray<HljsId>>> = {
  xml: ['css', 'javascript'],
  markdown: ['xml'],
};

const registered = new Set<HljsId>();

const registerGrammar = async (id: HljsId): Promise<void> => {
  if (registered.has(id)) return;
  registered.add(id);
  const grammar = await grammars[id]();
  hljs.registerLanguage(id, grammar.default);
  await Promise.all((embedded[id] ?? []).map(registerGrammar));
};

/** Maps a fence info string to the hljs id the reader's language table knows. */
const hljsIdForFence = (info: string): HljsId | undefined => {
  const lower = info.trim().toLowerCase();
  if (lower === '') return undefined;
  const byId = FILE_LANGUAGES.find((language) => language.hljsId === lower);
  if (byId?.hljsId !== undefined) return byId.hljsId;
  const byMatch = FILE_LANGUAGES.find((language) => language.match.some((match) => match.toLowerCase() === `.${lower}` || match.toLowerCase() === lower));
  return byMatch?.hljsId;
};

/**
 * The token of each highlight.js scope, by the class it writes (without the `hljs-` prefix), into the reader's
 * `--syntax-*` tokens. Copied from `syntax-colours.ts` so the markdown chunk can highlight code blocks on its own.
 */
const tokens: Readonly<Record<string, string>> = {
  keyword: 'tok-keyword',
  literal: 'tok-keyword',
  'variable language_': 'tok-keyword',
  'selector-tag': 'tok-keyword',
  name: 'tok-keyword',
  section: 'tok-keyword',
  doctag: 'tok-keyword',
  'template-tag': 'tok-keyword',
  string: 'tok-string',
  regexp: 'tok-string',
  'char escape_': 'tok-string',
  symbol: 'tok-string',
  link: 'tok-string',
  code: 'tok-string',
  addition: 'tok-string',
  number: 'tok-number',
  bullet: 'tok-number',
  deletion: 'tok-number',
  comment: 'tok-comment',
  quote: 'tok-comment',
  title: 'tok-function',
  'title function_': 'tok-function',
  'title function_ invoke__': 'tok-function',
  type: 'tok-type',
  built_in: 'tok-type',
  'title class_': 'tok-type',
  'title class_ inherited__': 'tok-type',
  'selector-class': 'tok-type',
  'selector-id': 'tok-type',
  variable: 'tok-variable',
  'variable constant_': 'tok-variable',
  attr: 'tok-variable',
  attribute: 'tok-variable',
  property: 'tok-variable',
  'template-variable': 'tok-variable',
  'selector-attr': 'tok-variable',
  'selector-pseudo': 'tok-variable',
  punctuation: 'tok-punctuation',
  operator: 'tok-punctuation',
  tag: 'tok-punctuation',
  meta: 'tok-meta',
};

const classForScope = (scope: string): string => {
  const classes = scope
    .split(' ')
    .map((part) => tokens[part.replace('hljs-', '')])
    .filter((token): token is string => token !== undefined);
  return [...new Set(classes)].join(' ');
};

/** Highlights one fenced block with highlight.js and rewrites the classes to the reader's tokens. */
const highlightBlock = async (code: string, info: string): Promise<string> => {
  const id = hljsIdForFence(info);
  if (id === undefined) return '';
  await registerGrammar(id);
  await Promise.all((embedded[id] ?? []).map(registerGrammar));
  const html = hljs.highlight(code.replaceAll('\r\n', '\n'), { language: id, ignoreIllegals: true }).value;
  // Replace each hljs scope span with the matching reader token span.
  return html.replace(/<span class="([^"]+)">/g, (_, classes: string) => {
    const mapped = classForScope(classes);
    return mapped === '' ? '<span>' : `<span class="${mapped}">`;
  });
};

/** What a file path of the Project is on disk, asked once per path while a page renders. */
export type KindOf = (path: string) => Promise<'file' | 'folder' | undefined>;

const ALLOWED_URI = /^(?:https?:|mailto:|tel:|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/** The heading's text as a reader sees it, without the Markdown marks. */
const textOf = (token: Token): string =>
  (token.children ?? []).map((child) => (child.type === 'text' || child.type === 'code_inline' ? child.content : child.type === 'softbreak' ? ' ' : '')).join('');

/** Renders Markdown to sanitized HTML in one lazy chunk. Links and images carry `data-timmy-*` attributes the caller acts on. */
export const renderMarkdown = async (options: RenderMarkdownOptions): Promise<RenderedMarkdown> => {
  const [{ default: MarkdownIt }, { default: createDOMPurify }, { default: GithubSlugger }] = await Promise.all([
    import('markdown-it'),
    import('dompurify'),
    import('github-slugger'),
  ]);

  const slugger = new GithubSlugger();
  const headings: string[] = [];
  const md = new MarkdownIt({ html: true });

  md.core.ruler.push('heading_ids', (state) => {
    state.tokens.forEach((token, index) => {
      const next = state.tokens[index + 1];
      if (token.type !== 'heading_open' || next === undefined) return;
      // Prefixed as GitHub does: a bare `id="title"` or `id="location"` would shadow a property of the document.
      const id = `${HEADING_ID_PREFIX}${slugger.slug(textOf(next))}`;
      headings.push(id);
      token.attrSet('id', id);
    });
  });

  const highlighted = await highlightCodeBlocks(md.render(options.content));

  // Sanitise first with no way to name a destination of ours, so nothing the README wrote can forge a `data-timmy-*`.
  const DOMPurify = createDOMPurify(window);
  const body = DOMPurify.sanitize(highlighted, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [...ALLOWED_ATTRS, 'href', 'src'],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    RETURN_DOM: true,
  }) as HTMLElement;

  await rewriteDestinations(body, options);
  // Code blocks and tables scroll sideways in their own box; the mark says so to the overflow check.
  for (const box of body.querySelectorAll('pre, table')) box.setAttribute('data-scrolls-x', '');
  return { html: body.innerHTML, headings };
};

/** Gives every link and image of the sanitised page its resolved meaning; nothing the README wrote is left in `href` or `src`. */
const rewriteDestinations = async (body: HTMLElement, options: RenderMarkdownOptions): Promise<void> => {
  const kinds = new Map<string, Promise<'file' | 'folder' | undefined>>();
  const kindOf = (path: string) => {
    const known = kinds.get(path) ?? options.kindOf(path);
    kinds.set(path, known);
    return known;
  };
  const inert = (element: Element, text: string) => {
    const span = element.ownerDocument.createElement('span');
    span.className = 'inert';
    span.setAttribute('title', options.inertTitle);
    span.textContent = text;
    element.replaceWith(span);
  };

  await Promise.all([
    ...Array.from(body.querySelectorAll('a')).map(async (link) => {
      const href = link.getAttribute('href');
      const resolved = href === null ? ({ kind: 'inert', reason: 'no-destination' } as const) : resolveInProject(options.path, href);
      link.removeAttribute('href');
      link.removeAttribute('src');
      switch (resolved.kind) {
        case 'anchor':
          link.setAttribute('href', '#');
          link.setAttribute('data-timmy-link', 'anchor');
          link.setAttribute('data-timmy-target', resolved.id);
          return;
        case 'external':
          link.setAttribute('href', '#');
          link.setAttribute('data-timmy-link', 'external');
          link.setAttribute('data-timmy-target', resolved.url);
          return;
        case 'inert':
          inert(link, link.textContent ?? '');
          return;
        case 'file':
        case 'folder': {
          const found = await kindOf(resolved.path);
          if (found === undefined) {
            inert(link, link.textContent ?? '');
            return;
          }
          link.setAttribute('data-timmy-link', found);
          link.setAttribute('data-timmy-target', resolved.path);
          link.setAttribute('href', '#');
        }
      }
    }),
    ...Array.from(body.querySelectorAll('img')).map(async (image) => {
      const src = image.getAttribute('src');
      const alt = image.getAttribute('alt') ?? '';
      image.removeAttribute('src');
      const resolved = src === null ? undefined : resolveImage(options.path, src);
      if (resolved?.kind !== 'file') {
        inert(image, alt);
        return;
      }
      image.setAttribute('data-timmy-image', resolved.path);
    }),
  ]);
};

/** Highlights every `<code class="language-*">` block markdown-it produced for a fence with a language. */
const highlightCodeBlocks = async (html: string): Promise<string> => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = doc.querySelectorAll<HTMLElement>('pre > code[class*="language-"]');
  await Promise.all(
    Array.from(blocks).map(async (block) => {
      const info = /language-(\S+)/.exec(block.className)?.[1] ?? '';
      const highlighted = await highlightBlock(block.textContent ?? '', info);
      if (highlighted !== '') block.innerHTML = highlighted;
    }),
  );
  return doc.body.innerHTML;
};
