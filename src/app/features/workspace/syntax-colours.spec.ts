import type { HljsId } from './file-language';
import { linesOf } from './source-text';
import { MAX_COLOURED_LINE, colourRanges } from './syntax-colours';

/** The coloured stretches of a text, each as `line token text`. */
const coloured = async (content: string, hljsId: HljsId) => {
  const lines = linesOf(content);
  const ranges = await colourRanges(content, hljsId);
  return ranges.map((range) => `${range.line} ${range.token} ${lines[range.line - 1].slice(range.from, range.to)}`);
};

describe('The colours of a source file', () => {
  it('are ranges of its lines, each with the kind of token it is', async () => {
    const source = "const answer = 42; // the answer\nexport class Reader extends Base {\n  @Input() name = 'timmy';\n}\n";
    expect(await coloured(source, 'typescript')).toEqual([
      '1 keyword const',
      '1 number 42',
      '1 comment // the answer',
      '2 keyword export',
      '2 keyword class',
      '2 type Reader',
      '2 keyword extends',
      '2 type Base',
      '3 meta @Input',
      "3 string 'timmy'",
    ]);
  });

  it('tell a function from a variable', async () => {
    expect(await coloured('function twice(n) {\n  return this.n * 2;\n}\n', 'javascript')).toEqual([
      '1 keyword function',
      '1 function twice',
      '2 keyword return',
      '2 keyword this',
      '2 variable n',
      '2 number 2',
    ]);
  });

  it('count offsets in the text, not in its escaped form', async () => {
    expect(await coloured('const a = b < c && "<&>"; // x\n', 'javascript')).toEqual(['1 keyword const', '1 string "<&>"', '1 comment // x']);
  });

  it('follow a token that spans lines, one range per line', async () => {
    expect(await coloured('/* one\n   two */\nlet a;\n', 'javascript')).toEqual(['1 comment /* one', '2 comment    two */', '3 keyword let']);
  });

  it('are the same for CRLF line endings, which are not part of a line', async () => {
    expect(await coloured('/* one\r\n   two */\r\nlet a;\r\n', 'javascript')).toEqual(['1 comment /* one', '2 comment    two */', '3 keyword let']);
  });

  it('colour the tags, attributes and values of markup', async () => {
    expect(await coloured('<a href="x">hi</a>\n', 'xml')).toEqual([
      '1 punctuation <',
      '1 keyword a',
      '1 punctuation  ',
      '1 variable href',
      '1 punctuation =',
      '1 string "x"',
      '1 punctuation >',
      '1 punctuation </',
      '1 keyword a',
      '1 punctuation >',
    ]);
  });

  it('colour the keys and values of TOML and env files as INI', async () => {
    expect(await coloured('[package]\nname = "timmy"\nPORT=4200\n', 'ini')).toEqual(['1 keyword [package]', '2 variable name', '2 string "timmy"', '3 variable PORT', '3 number 4200']);
  });

  it('leave a line over the limit plain and colour the others', async () => {
    const long = `const a = '${'x'.repeat(MAX_COLOURED_LINE)}';`;
    expect(await coloured(`let a;\n${long}\nlet b;\n`, 'javascript')).toEqual(['1 keyword let', '3 keyword let']);
  });
});
