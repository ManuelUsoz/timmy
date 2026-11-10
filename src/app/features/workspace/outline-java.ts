import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/java';
import type { OutlineFamily } from './symbol-outline';

type Text = (node: SyntaxNode) => string;

/** The text of the declaration's name: its `Definition` child, an `Identifier` for an annotation type. */
const definition = (node: SyntaxNode, text: Text): string | undefined => {
  const name = node.getChild('Definition') ?? node.getChild('Identifier');
  return name === null ? undefined : text(name);
};

const callable = (node: SyntaxNode, text: Text): string | undefined => {
  const name = definition(node, text);
  return name === undefined ? undefined : `${name}()`;
};

/**
 * The outline table of Java: class, interface, enum, record and annotation declarations, and the method, constructor
 * and compact constructor members. Nested types come free: they are the same nodes deeper in the tree.
 */
export const javaOutline: OutlineFamily = {
  parse: (content) => parser.parse(content),
  symbols: {
    ClassDeclaration: definition,
    InterfaceDeclaration: definition,
    EnumDeclaration: definition,
    RecordDeclaration: definition,
    AnnotationTypeDeclaration: definition,
    MethodDeclaration: callable,
    ConstructorDeclaration: callable,
    CompactConstructorDeclaration: callable,
  },
};
