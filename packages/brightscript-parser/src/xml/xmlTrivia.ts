/**
 * Trivia for the SceneGraph XML CST — mirrors `../trivia.ts`'s model for the
 * BrightScript CST exactly, including the horizontal-whitespace/line-break
 * split: that split is what lets `xmlLexer.ts` attach a same-line comment as
 * *trailing* trivia of the previous token and a comment on its own line as
 * *leading* trivia of the next one — the comment-ownership rule
 * `tokenizeXmlInterfaceElements` (`sceneGraphQueries.ts`) relies on directly,
 * rather than reimplementing it by hand.
 */

export enum XmlTriviaKind {
  /** Horizontal whitespace: spaces and tabs (no line breaks). */
  Whitespace = 'Whitespace',
  /** One line break: `\n` or `\r\n`. */
  LineBreak = 'LineBreak',
  /** `<!-- ... -->`. Only valid in content position (never inside a tag). */
  Comment = 'Comment',
  /** `<? ... ?>` — an XML declaration or other processing instruction. */
  ProcessingInstruction = 'ProcessingInstruction',
}

export interface XmlTrivia {
  readonly kind: XmlTriviaKind;
  /** The original source text of this trivia piece. */
  readonly text: string;
  /** Byte offset in the source where this trivia starts. */
  readonly pos: number;
  /** Byte offset just past the end of this trivia. */
  readonly end: number;
  /** 0-based line number of the trivia start. */
  readonly line: number;
  /** 0-based column of the trivia start. */
  readonly column: number;
}
