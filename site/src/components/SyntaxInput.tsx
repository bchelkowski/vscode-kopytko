/**
 * SyntaxInput — a textarea with live BrightScript syntax highlighting.
 *
 * Uses the overlay technique:
 *   - A <pre> with colored <span>s sits behind as the visual layer.
 *   - A transparent <textarea> sits on top for editing.
 *   - Scroll events keep both layers in sync.
 */
import { useRef, useMemo, useCallback } from 'react';
import { renderHighlighted } from '../utils/brightscript-colors';

interface Props {
  value: string;
  onChange: (val: string) => void;
  height?: string;
  placeholder?: string;
}

const FONT = '"JetBrains Mono", "Fira Code", ui-monospace, monospace';
const SHARED: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: '0.875rem',
  lineHeight: '1.625rem',
  padding: '1rem',
  whiteSpace: 'pre',
  tabSize: 4,
  margin: 0,
  boxSizing: 'border-box',
};

export default function SyntaxInput({ value, onChange, height = '18rem', placeholder }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const hlRef = useRef<HTMLPreElement>(null);

  const nodes = useMemo(() => renderHighlighted(value), [value]);

  const syncScroll = useCallback(() => {
    const ta = taRef.current;
    const hl = hlRef.current;
    if (ta && hl) {
      hl.scrollTop  = ta.scrollTop;
      hl.scrollLeft = ta.scrollLeft;
    }
  }, []);

  return (
    <div style={{ position: 'relative', height, overflow: 'hidden' }}>
      {/* Colour layer — behind, no pointer events */}
      <pre
        ref={hlRef}
        aria-hidden
        style={{
          ...SHARED,
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 0,
          color: '#e2e8f0',
          background: 'transparent',
        }}
      >
        {nodes}
        {/* Trailing newline prevents last-line height collapse */}
        {'\n'}
      </pre>

      {/* Editable layer — in front, transparent text so colours show through */}
      <textarea
        ref={taRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        placeholder={placeholder}
        style={{
          ...SHARED,
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          background: 'transparent',
          color: 'transparent',
          caretColor: '#e2e8f0',
          resize: 'none',
          outline: 'none',
          border: 'none',
          overflowY: 'auto',
          overflowX: 'auto',
          zIndex: 1,
        }}
      />
    </div>
  );
}
