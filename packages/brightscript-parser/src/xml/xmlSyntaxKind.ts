/** Node kinds in the SceneGraph XML CST. */
export enum XmlSyntaxKind {
  /** The whole document: prolog trivia + exactly one root `Element` (usually `<component>`). */
  Document = 'Document',
  /** An element: open tag + attributes + children + close tag, or a self-closing tag. */
  Element = 'Element',
  /** A single `name="value"` (or `name='value'`) pair inside a tag. */
  Attribute = 'Attribute',
  /** Non-whitespace text content between tags. */
  Text = 'Text',
  /** Unparseable content the parser recovered from — see `../syntaxKind.ts`'s `ErrorNode`. */
  ErrorNode = 'ErrorNode',
}
