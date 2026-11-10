import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/javascript';
import type { SymbolsId } from './file-language';
import type { OutlineFamily } from './symbol-outline';

/** The Lezer dialect of each language of the family. */
const dialects: Partial<Record<SymbolsId, string>> = { typescript: 'ts', tsx: 'ts jsx', jsx: 'jsx' };

type Text = (node: SyntaxNode) => string;

/** The text of the first child that names the declaration. */
const named =
  (...names: ReadonlyArray<string>) =>
  (node: SyntaxNode, text: Text): string | undefined => {
    for (let child = node.firstChild; child !== null; child = child.nextSibling) if (names.includes(child.name)) return text(child);
    return undefined;
  };

const definition = named('VariableDefinition', 'TypeDefinition');
const member = named('PropertyDefinition', 'PrivatePropertyDefinition');

/** A function's symbol is its name with `()`; an anonymous one is none. */
const callable =
  (name: (node: SyntaxNode, text: Text) => string | undefined) =>
  (node: SyntaxNode, text: Text): string | undefined => {
    const found = name(node, text);
    return found === undefined ? undefined : `${found}()`;
  };

/** A function the name of its binding gives: `const run = () => {}`, `run = function () {}` in a class. */
const boundFunction = (node: SyntaxNode, text: Text): string | undefined => {
  const name = node.prevSibling?.prevSibling;
  if (name === null || name === undefined) return undefined;
  if (name.name === 'VariableDefinition' || name.name === 'PropertyDefinition' || name.name === 'PrivatePropertyDefinition') return `${text(name)}()`;
  return undefined;
};

/** The outline table of TypeScript, TSX, JavaScript and JSX. */
export const javascriptOutline: OutlineFamily = {
  parse: (content, symbols) => parser.configure({ dialect: dialects[symbols] ?? '' }).parse(content),
  symbols: {
    ClassDeclaration: definition,
    ClassExpression: definition,
    InterfaceDeclaration: definition,
    TypeAliasDeclaration: definition,
    EnumDeclaration: definition,
    NamespaceDeclaration: definition,
    FunctionDeclaration: callable(definition),
    MethodDeclaration: callable(member),
    MethodType: callable(member),
    // `{ run() {} }`: a property with parameters is a method.
    Property: (node, text) => (node.getChild('ParamList') === null ? undefined : callable(member)(node, text)),
    ArrowFunction: boundFunction,
    FunctionExpression: boundFunction,
  },
};
