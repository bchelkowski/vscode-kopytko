import { useState, useCallback, useRef } from 'react';
import { tokenize, parse, TokenKind, isTypeKeyword } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';

const SAMPLE = `' BrightScript sample — edit to explore
function greet(name as String) as String
  if name = "" or name = invalid then
    return "Hello, World!"
  end if
  return "Hello, " + name + "!"
end function

sub main()
  colors = ["red", "green", "blue"]
  for i = 0 to colors.Count() - 1
    print colors[i]  ' current color
  end for
  m.count = 0
  m.count++
  result = greet("Roku")
end sub`;

type Category = 'keyword' | 'str-literal' | 'num-literal' | 'bool-literal' | 'identifier' | 'type' | 'operator' | 'punctuation' | 'comment' | 'preprocessor' | 'special';

const KEYWORD_KINDS = new Set<string>([
  'And','As','Box','Catch','Continue','CreateObject','Dim','Each','Else','ElseIf',
  'End','EndFor','EndFunction','EndIf','EndSub','EndWhile','EndTry','Eval','Exit',
  'ExitWhile','For','Function','GetGlobalAA','GetLastRunCompileError',
  'GetLastRunRunTimeError','Goto','If','In','Let','LineNum','Mod','Next','Not',
  'ObjFun','Or','Pos','Print','Return','Run','Step','Stop','Sub','Tab','Then',
  'Throw','To','Try','Type','While',
]);
const BOOL_KINDS = new Set<string>(['True','False','Invalid']);
const LITERAL_STR_KINDS = new Set<string>(['StringLiteral']);
const LITERAL_NUM_KINDS = new Set<string>(['IntegerLiteral','LongIntegerLiteral','FloatLiteral','DoubleLiteral']);
const OPERATOR_KINDS = new Set<string>([
  'Plus','Minus','Star','Slash','Backslash','Caret','Equal','LessGreater','Less',
  'Greater','LessEqual','GreaterEqual','LeftShift','RightShift','PlusEqual',
  'MinusEqual','StarEqual','SlashEqual','BackslashEqual','LeftShiftEqual',
  'RightShiftEqual','PlusPlus','MinusMinus','QuestionDot','QuestionBracket',
  'QuestionParen','QuestionAt',
]);
const PUNCTUATION_KINDS = new Set<string>([
  'LeftParen','RightParen','LeftBracket','RightBracket','LeftBrace','RightBrace',
  'Dot','Comma','Colon','Semicolon','At','QuestionMark',
]);
const PREPROCESSOR_KINDS = new Set<string>([
  'HashIf','HashElseIf','HashElse','HashEndIf','HashConst','HashError',
]);

function getCategory(kind: string): Category {
  if (BOOL_KINDS.has(kind)) return 'bool-literal';
  if (KEYWORD_KINDS.has(kind)) return 'keyword';
  if (LITERAL_STR_KINDS.has(kind)) return 'str-literal';
  if (LITERAL_NUM_KINDS.has(kind)) return 'num-literal';
  if (kind === 'Identifier') return 'identifier';
  if (OPERATOR_KINDS.has(kind)) return 'operator';
  if (PUNCTUATION_KINDS.has(kind)) return 'punctuation';
  if (PREPROCESSOR_KINDS.has(kind)) return 'preprocessor';
  return 'special';
}

const CATEGORY_LABELS: Record<Category, string> = {
  keyword: 'Keyword',
  'str-literal': 'String literal',
  'num-literal': 'Number literal',
  'bool-literal': 'Bool / Invalid',
  identifier: 'Identifier',
  type: 'Type name',
  operator: 'Operator',
  punctuation: 'Punctuation',
  comment: 'Comment',
  preprocessor: 'Preprocessor',
  special: 'Special',
};

const CATEGORY_COLORS: Record<Category, string> = {
  keyword: '#c792ea',
  'str-literal': '#c3e88d',
  'num-literal': '#f78c6c',
  'bool-literal': '#c792ea',
  identifier: '#82aaff',
  type: '#4ec9b0',
  operator: '#89ddff',
  punctuation: '#7e8da0',
  comment: '#546e7a',
  preprocessor: '#ffcb6b',
  special: '#ff5370',
};

interface RenderedPart {
  text: string;
  category: Category | 'whitespace';
  tokenKind?: string;
}

function renderTokens(tokens: Token[], typeNamePositions: Set<number>): RenderedPart[] {
  const parts: RenderedPart[] = [];

  for (const token of tokens) {
    // Leading trivia
    for (const t of token.leadingTrivia) {
      if (t.kind === 'Comment' || t.kind === 'RemComment') {
        parts.push({ text: t.text, category: 'comment' });
      } else {
        parts.push({ text: t.text, category: 'whitespace' });
      }
    }

    // Token itself (skip EOF)
    if (token.kind !== TokenKind.Eof) {
      // Use the CST-derived TypeName positions for accurate type detection
      const cat: Category = typeNamePositions.has(token.pos) ? 'type' : getCategory(token.kind);
      parts.push({ text: token.text, category: cat, tokenKind: token.kind });
    }

    // Trailing trivia
    for (const t of token.trailingTrivia) {
      if (t.kind === 'Comment' || t.kind === 'RemComment') {
        parts.push({ text: t.text, category: 'comment' });
      } else {
        parts.push({ text: t.text, category: 'whitespace' });
      }
    }
  }

  return parts;
}

export default function TokenVisualizer() {
  const [source, setSource] = useState(SAMPLE);
  const [view, setView] = useState<'source' | 'list'>('source');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const tokens = (() => {
    try { return tokenize(source); } catch { return []; }
  })();

  // Collect byte-offsets of TypeName tokens from the CST so the visualizer
  // can colour them correctly without context-based heuristics.
  const typeNamePositions = (() => {
    try {
      const { root } = parse(source);
      const positions = new Set<number>();
      function collectTypeNames(node: import('kopytko-brightscript-parser').SyntaxNode): void {
        for (const child of node.children) {
          if (typeof child === 'object' && 'kind' in child && 'text' in child) {
            // It's a token
            const tok = child as Token;
            if (isTypeKeyword(tok.kind)) positions.add(tok.pos);
          } else if (typeof child === 'object' && 'children' in child) {
            collectTypeNames(child as import('kopytko-brightscript-parser').SyntaxNode);
          }
        }
      }
      collectTypeNames(root);
      return positions;
    } catch { return new Set<number>(); }
  })();

  const parts = renderTokens(tokens, typeNamePositions);
  const significantTokens = tokens.filter(t => t.kind !== TokenKind.Eof);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSource(val), 150);
    e.target.value = val;
    setSource(val);
  }, []);

  // Count by rendered category (includes context-detected 'type' tokens)
  const categoryCount = parts.reduce<Record<string, number>>((acc, part) => {
    if (part.category !== 'whitespace') {
      acc[part.category] = (acc[part.category] ?? 0) + 1;
    }
    return acc;
  }, {});

  return (
    <div className="rounded-xl border border-[#1e2d4a] bg-[#0f1923] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2d4a] bg-[#070b14]/50">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-300">Live Tokenizer</span>
          <span className="text-xs text-slate-500 bg-slate-800/50 px-2 py-0.5 rounded-full">
            {significantTokens.length} tokens
          </span>
        </div>
        <div className="flex gap-1 bg-slate-800/60 rounded-lg p-0.5">
          {(['source', 'list'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                view === v
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v === 'source' ? 'Highlighted source' : 'Token list'}
            </button>
          ))}
        </div>
      </div>

      {/* Editor + output */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#1e2d4a]">
        {/* Input */}
        <div className="relative">
          <div className="px-3 py-1.5 text-xs text-slate-500 border-b border-[#1e2d4a] bg-[#070b14]/30">
            Input — edit to see live tokenization
          </div>
          <textarea
            defaultValue={SAMPLE}
            onChange={handleChange}
            spellCheck={false}
            className="w-full h-80 bg-transparent p-4 font-mono text-sm text-slate-200 resize-none outline-none leading-relaxed"
            style={{ fontFamily: 'JetBrains Mono, Fira Code, monospace' }}
          />
        </div>

        {/* Output */}
        <div className="overflow-auto max-h-[400px]">
          <div className="px-3 py-1.5 text-xs text-slate-500 border-b border-[#1e2d4a] bg-[#070b14]/30 sticky top-0">
            {view === 'source' ? 'Token-colored source' : 'Sequential token stream'}
          </div>

          {view === 'source' ? (
            <pre
              className="p-4 text-sm leading-relaxed overflow-auto"
              style={{ fontFamily: 'JetBrains Mono, Fira Code, monospace' }}
            >
              {parts.map((part, i) => {
                if (part.category === 'whitespace') {
                  return <span key={i}>{part.text}</span>;
                }
                const color = part.category === 'comment' || part.category === 'comment-trivia'
                  ? CATEGORY_COLORS['comment']
                  : CATEGORY_COLORS[part.category as Category] ?? '#e2e8f0';
                return (
                  <span
                    key={i}
                    style={{ color }}
                    title={part.tokenKind ?? part.category}
                  >
                    {part.text}
                  </span>
                );
              })}
            </pre>
          ) : (
            <div className="p-3 space-y-0.5">
              {significantTokens.map((token, i) => {
                const isType = typeNamePositions.has(token.pos);
                const cat = isType ? 'type' : getCategory(token.kind);
                const displayKind = isType ? 'TypeName' : token.kind;
                return (
                  <div key={i} className="flex items-center gap-2 py-0.5 px-2 rounded hover:bg-white/5 group">
                    <span
                      className="text-xs font-mono shrink-0 w-36 truncate"
                      style={{ color: CATEGORY_COLORS[cat] }}
                    >
                      {displayKind}
                    </span>
                    <span className="text-xs text-slate-400 font-mono truncate group-hover:text-slate-200">
                      {JSON.stringify(token.text)}
                    </span>
                    <span className="text-xs text-slate-600 shrink-0 ml-auto">
                      {token.line + 1}:{token.column + 1}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Legend + stats */}
      <div className="border-t border-[#1e2d4a] px-4 py-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {(Object.keys(CATEGORY_LABELS) as Category[]).map(cat => {
            const count = categoryCount[cat] ?? 0;
            if (count === 0) return null;
            return (
              <div key={cat} className="flex items-center gap-1.5 text-xs">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
                <span className="text-slate-400">{CATEGORY_LABELS[cat]}</span>
                <span className="text-slate-600">({count})</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
