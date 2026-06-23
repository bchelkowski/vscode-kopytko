import type { SyntaxNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

export function lineCommentPositionPass(position: 'above' | 'preserve'): (root: SyntaxNode, source: string) => TextEdit[] {
  if (position !== 'above') return () => [];
  return (_root: SyntaxNode, source: string): TextEdit[] => {
    const edits: TextEdit[] = [];
    const lines = source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("'") || /^rem\b/i.test(trimmed)) continue;
      const commentIdx = findTrailingComment(line);
      if (commentIdx < 0) continue;
      const code = line.slice(0, commentIdx).trimEnd();
      const comment = line.slice(commentIdx);
      const indent = line.match(/^(\s*)/)?.[1] ?? '';
      const lineStart = lines.slice(0, i).reduce((s, l) => s + l.length + 1, 0);
      edits.push({ pos: lineStart, end: lineStart + line.length, newText: indent + comment + '\n' + indent + code });
    }
    return edits;
  };
}
function findTrailingComment(line: string): number {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { if (inStr && line[i+1] === '"') { i++; continue; } inStr = !inStr; }
    else if (!inStr && line[i] === "'") return i;
  }
  return -1;
}
