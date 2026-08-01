/**
 * Token kinds for the SceneGraph XML lexer/parser.
 *
 * Scoped to what SceneGraph component XML actually uses — element tags,
 * attributes, text content, comments. Not a general XML/DTD/namespace/CDATA
 * grammar; see the package README for the same scoping rationale as
 * `tokenizeXmlInterfaceElements`.
 */
export enum XmlTokenKind {
  // ── Tag delimiters ─────────────────────────────────────────────────────
  LessThan = 'LessThan',                   // <
  LessSlash = 'LessSlash',                 // </
  SlashGreaterThan = 'SlashGreaterThan',   // />
  GreaterThan = 'GreaterThan',             // >
  Equals = 'Equals',                       // =

  // ── Names and values ───────────────────────────────────────────────────
  Name = 'Name',                           // tag or attribute name
  StringLiteral = 'StringLiteral',         // 'quoted' or "quoted" attribute value
  Text = 'Text',                           // non-whitespace text content between tags

  // ── Special ─────────────────────────────────────────────────────────────
  Eof = 'Eof',
  Unknown = 'Unknown',
}
