import { describe, expect, it } from 'vitest';
import { MarkdownPipe } from './markdown.pipe';

describe('MarkdownPipe', () => {
  const pipe = new MarkdownPipe();

  it('renders headings, emphasis and code', () => {
    const html = pipe.transform('# Title\n\n**bold** and `code`');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('renders lists and fenced blocks', () => {
    const html = pipe.transform('- a\n- b\n\n```ts\nconst x = 1;\n```');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<pre><code class="language-ts">');
  });
});
