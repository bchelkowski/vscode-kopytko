import { createHighlighter, type Highlighter, type LanguageRegistration } from 'shiki';
import brsGrammar from '@brs-grammar';

const BRS_LANG = 'BrightScript';

let _h: Highlighter | null = null;
let _initPromise: Promise<Highlighter> | null = null;

function initHighlighter(): Promise<Highlighter> {
  if (_initPromise) return _initPromise;
  _initPromise = createHighlighter({
    themes: ['github-dark'],
    langs: [
      brsGrammar as unknown as LanguageRegistration,
      'typescript', 'javascript', 'json', 'jsonc', 'yaml', 'bash', 'shell',
    ],
  }).then(h => {
    _h = h;
    return h;
  });
  return _initPromise;
}

async function getHighlighter(): Promise<Highlighter> {
  if (_h) return _h;
  return initHighlighter();
}

const LANG_ALIASES: Record<string, string> = {
  brightscript: BRS_LANG,
  brs: BRS_LANG,
};

export async function highlight(code: string, lang = 'brightscript'): Promise<string> {
  const h = await getHighlighter();
  const resolvedLang = LANG_ALIASES[lang.toLowerCase()] ?? lang;
  return h.codeToHtml(code.trim(), { lang: resolvedLang, theme: 'github-dark' });
}
