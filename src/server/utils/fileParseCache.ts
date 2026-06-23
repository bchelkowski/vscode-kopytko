import * as nodePath from 'path';
import fsWrapper from './fsWrapper';
import {
  parseFunctionDefs,
  parseInnerMethodDefs,
  FunctionDefinition,
  InnerMethodDefinition,
} from '../brightscript/functionIndex';
import { parse as parseBrs } from 'kopytko-brightscript-parser';
import type { ParseResult } from 'kopytko-brightscript-parser';

/**
 * Cross-document, file-level read + parse cache, keyed by normalized path.
 *
 * Workspace-wide operations (Find References, Rename) and the import-chain
 * collectors in `functionIndex.ts` otherwise re-read and re-parse the same .brs
 * files from disk on every request. This module reads each file once and
 * memoizes its text and parsed definitions so that work is shared across all
 * open documents and across providers.
 *
 * Staleness model: **trust-the-watcher** — identical to `WorkspaceFunctionIndex`.
 * The cache holds exactly the bytes the file watcher promises to invalidate;
 * `server.ts` evicts changed paths via `invalidateFileParseCache` on
 * `onDidChangeWatchedFiles`, and `invalidateAllCaches()` clears everything as a
 * backstop. The cache is therefore never keyed by mtime/stat (which would add a
 * `stat` per access and break the Sinon-stubbed test suite).
 *
 * IMPORTANT: callers must never serve cached *disk* text for the document the
 * user is actively editing — the entry document's live text always wins. The
 * import-chain collectors enforce this by parsing the passed entry text directly
 * and only consulting this cache for *non-entry* (imported/sibling/extends)
 * files. See `functionIndex.ts`.
 */
interface FileRecord {
  text: string;
  funcDefs?: FunctionDefinition[];
  innerDefs?: InnerMethodDefinition[];
  parseResult?: ParseResult;
}

const _cache = new Map<string, FileRecord>();
/** Directory listings (name + isDirectory), keyed by normalized dir path. */
const _dirCache = new Map<string, ReturnType<typeof fsWrapper.readdirTyped>>();
/** Soft upper bound; far above any real workspace's hot set. FIFO eviction. */
const MAX_FILE_CACHE = 2000;

/**
 * Normalizes a path for use as the cache key. Mirrors `normalizePathKey` in
 * `functionIndex.ts`: on case-insensitive file systems the path is lowercased so
 * that different casings of the same file share one entry.
 */
function keyFor(filePath: string): string {
  const n = nodePath.normalize(filePath);
  return process.platform === 'linux' ? n : n.toLowerCase();
}

/**
 * Reads, caches, and returns a record for `filePath`, or `undefined` when the
 * file cannot be read (the failure is not cached). The text is read with
 * `'utf-8'` — the dominant convention across the codebase — and the cache key is
 * the normalized path only, never `(path, encoding)`.
 */
function ensureRecord(filePath: string): FileRecord | undefined {
  const key = keyFor(filePath);
  const existing = _cache.get(key);
  if (existing) return existing;

  let text: string;
  try {
    text = fsWrapper.readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }

  if (_cache.size >= MAX_FILE_CACHE) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }

  const record: FileRecord = { text };
  _cache.set(key, record);
  return record;
}

/** Returns the file's text (cached), or `undefined` if it could not be read. */
export function readCachedFileText(filePath: string): string | undefined {
  return ensureRecord(filePath)?.text;
}

/**
 * Returns the file's top-level function/sub definitions (cached), or `undefined`
 * if it could not be read. Parses lazily from the cached text on first request.
 */
export function getCachedFunctionDefs(filePath: string): FunctionDefinition[] | undefined {
  const record = ensureRecord(filePath);
  if (!record) return undefined;
  if (!record.funcDefs) {
    record.funcDefs = parseFunctionDefs(record.text, nodePath.normalize(filePath));
  }
  return record.funcDefs;
}

/**
 * Returns the file's associative-array (inner) method definitions (cached), or
 * `undefined` if it could not be read. Parses lazily from the cached text.
 */
export function getCachedInnerMethodDefs(filePath: string): InnerMethodDefinition[] | undefined {
  const record = ensureRecord(filePath);
  if (!record) return undefined;
  if (!record.innerDefs) {
    record.innerDefs = parseInnerMethodDefs(record.text, nodePath.normalize(filePath));
  }
  return record.innerDefs;
}

/**
 * Reads and caches a directory's typed entries (name + isDirectory) by path.
 * Used by import-path completion, which otherwise lists the same directory on
 * every keystroke. Returns `undefined` when the directory cannot be read.
 * Cleared together with the file cache (so any watched-file change drops it).
 */
export function readCachedDir(dir: string): ReturnType<typeof fsWrapper.readdirTyped> | undefined {
  const key = keyFor(dir);
  const existing = _dirCache.get(key);
  if (existing) return existing;

  let entries: ReturnType<typeof fsWrapper.readdirTyped>;
  try {
    entries = fsWrapper.readdirTyped(dir);
  } catch {
    return undefined;
  }
  if (!entries) return undefined;
  _dirCache.set(key, entries);
  return entries;
}

/**
 * Returns a lazily-parsed AST (`ParseResult`) for `filePath` (cached).
 * Unlike `getCachedFunctionDefs` this returns the full CST so providers
 * can walk it (e.g. Find References). Returns `undefined` when the file
 * cannot be read.
 *
 * NOTE: The name `getCachedParseResult` also exists in `documentCache.ts`
 * for the active TextDocument.  This variant takes a file-path string and
 * is intended for workspace-wide scanning of files that are not currently
 * open in the editor.
 */
export function getCachedFileParseResult(filePath: string): ParseResult | undefined {
  const record = ensureRecord(filePath);
  if (!record) return undefined;
  if (!record.parseResult) record.parseResult = parseBrs(record.text);
  return record.parseResult;
}

/** Evicts a single file's cached text + parses (call when that file changes on disk). */
export function invalidateFileParseCache(filePath: string): void {
  _cache.delete(keyFor(filePath));
}

/** Clears the entire cache. Wired into `invalidateAllCaches()` in documentCache.ts. */
export function clearFileParseCache(): void {
  _cache.clear();
  _dirCache.clear();
}

/** Number of cached files. Exposed for tests/diagnostics. */
export function fileParseCacheSize(): number {
  return _cache.size;
}
