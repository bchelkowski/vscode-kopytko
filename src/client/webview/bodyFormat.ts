/**
 * Pure body-formatting helpers shared by the Network Inspector webview
 * (Formatted tab) and the extension host (opening a full body in an editor
 * tab). Deliberately import-free — like `textDiff.ts`, it bundles into the
 * browser via esbuild and unit-tests directly via tsx.
 */

/** Best-effort indent by tag depth — not a real XML parser, just a readability aid. */
export function tryFormatXml(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('<')) return null;
  try {
    let indent = 0;
    const lines = trimmed.replace(/>\s*</g, '>\n<').split('\n');
    const out = lines.map((line) => {
      const isClosing = /^<\//.test(line);
      const isSelfClosingOrDecl = /\/>\s*$/.test(line) || /^<\?/.test(line) || /^<!/.test(line);
      // `<tag>text</tag>` opens and closes on one line — indenting deeper
      // after it staircases every flat element list (the common API shape).
      const isOneLineElement = /^<[a-zA-Z][^>]*>.*<\/[a-zA-Z][\w:.-]*>\s*$/.test(line);
      if (isClosing) indent = Math.max(0, indent - 1);
      const rendered = '  '.repeat(indent) + line;
      if (!isClosing && !isSelfClosingOrDecl && !isOneLineElement && /^<[a-zA-Z]/.test(line)) indent += 1;
      return rendered;
    });
    return out.join('\n');
  } catch {
    return null;
  }
}

export interface FormattedBody {
  content: string;
  /** VS Code language id for the editor tab (`json` / `xml` / `html` / `plaintext`). */
  language: string;
}

/**
 * Formats a text body for an editor tab: pretty-printed JSON when it parses
 * (same rule the webview's Formatted tab uses), best-effort reindented XML,
 * otherwise the raw text. HTML is passed through unindented — the naive tag
 * indenter mangles inline markup.
 */
export function formatBodyForEditor(text: string, contentType: string): FormattedBody {
  try {
    return { content: JSON.stringify(JSON.parse(text), null, 2), language: 'json' };
  } catch {
    // Not JSON — fall through.
  }
  if (contentType.toLowerCase().includes('html')) return { content: text, language: 'html' };
  const xml = tryFormatXml(text);
  if (xml !== null) return { content: xml, language: 'xml' };
  return { content: text, language: 'plaintext' };
}
