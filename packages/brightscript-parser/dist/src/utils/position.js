"use strict";
/**
 * Position-based CST node lookup.
 *
 * Given a cursor position (line, column), finds the deepest CST node
 * and token at that position. This is the foundation for all LSP features
 * that need context at the cursor: hover, go-to-definition, completion,
 * signature help, rename, references.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findNodeAtPosition = findNodeAtPosition;
exports.findTokenAtPosition = findTokenAtPosition;
exports.getWordAtPosition = getWordAtPosition;
exports.escapeRegex = escapeRegex;
const syntaxNode_js_1 = require("../syntaxNode.js");
/**
 * Finds the deepest CST node at the given line and column.
 *
 * @param root - The root SourceFile node.
 * @param line - 0-based line number.
 * @param column - 0-based column (character offset within line).
 * @returns The node, token, and ancestor chain at the position, or null if not found.
 */
function findNodeAtPosition(root, line, column) {
    const ancestors = [];
    const result = findDeepest(root, line, column, ancestors);
    if (!result)
        return null;
    return result;
}
function findDeepest(node, line, column, ancestors) {
    ancestors.push(node);
    // Check children in order — find the deepest match
    for (const child of node.children) {
        if ((0, syntaxNode_js_1.isToken)(child)) {
            if (child.line === line && column >= child.column && column < child.column + child.text.length) {
                return { node, token: child, ancestors: [...ancestors] };
            }
            // Also check trivia (comments at cursor position)
            for (const trivia of child.leadingTrivia) {
                if (containsPosition(trivia.pos, trivia.end, line, column, child)) {
                    return { node, token: child, ancestors: [...ancestors] };
                }
            }
        }
        else if ((0, syntaxNode_js_1.isNode)(child)) {
            const result = findDeepest(child, line, column, ancestors);
            if (result)
                return result;
        }
    }
    ancestors.pop();
    return null;
}
function containsPosition(_pos, _end, _line, _column, _token) {
    // Simplified — for trivia we'd need byte-offset-to-line mapping
    // For now, token-level matching is sufficient for LSP features
    return false;
}
/**
 * Finds the token at the given line and column by scanning all tokens.
 * Simpler than findNodeAtPosition — just returns the token, no ancestors.
 */
function findTokenAtPosition(root, line, column) {
    let found;
    function walk(node) {
        for (const child of node.children) {
            if ((0, syntaxNode_js_1.isToken)(child)) {
                if (child.line === line && column >= child.column && column < child.column + child.text.length) {
                    found = child;
                    return;
                }
            }
            else if ((0, syntaxNode_js_1.isNode)(child)) {
                walk(child);
                if (found)
                    return;
            }
        }
    }
    walk(root);
    return found;
}
/**
 * Gets the identifier word at the given position in a line of text.
 * Returns the word and its start/end columns, or null if not on an identifier.
 *
 * This replaces the regex-based `getWord` / `getWordInfo` in textUtils.
 */
function getWordAtPosition(line, column) {
    if (column < 0 || column >= line.length)
        return null;
    // Expand left to find word start
    let start = column;
    while (start > 0 && isIdentChar(line[start - 1]))
        start--;
    // Expand right to find word end
    let end = column;
    while (end < line.length && isIdentChar(line[end]))
        end++;
    if (start === end)
        return null;
    const word = line.slice(start, end);
    // Must start with alpha or underscore to be a valid identifier
    if (!isIdentStart(word[0]))
        return null;
    return { word, start, end };
}
function isIdentChar(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '_';
}
function isIdentStart(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}
/**
 * Escapes special regex characters in a string.
 * Shared utility used by linter rules and LSP providers.
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=position.js.map