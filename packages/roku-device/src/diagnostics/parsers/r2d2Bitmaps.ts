import { stripConsoleResponse } from './consoleResponse';

/** A single loaded bitmap/texture, parsed from `r2d2_bitmaps` (port 8080). */
export interface TextureBitmap {
  /** Bitmap address (hex string, e.g. `0x9668bf69`). */
  address: string;
  width: number;
  height: number;
  /** Bytes per pixel. */
  bpp: number;
  /** Texture size, bytes. */
  sizeBytes: number;
  /** Source path/name, when present (render targets have none). */
  name: string;
}

/** Texture-memory snapshot, parsed from `r2d2_bitmaps` (port 8080). */
export interface R2d2Bitmaps {
  bitmaps: TextureBitmap[];
  /** Number of bitmap rows. */
  count: number;
  /** Sum of all bitmap `sizeBytes`. */
  totalSizeBytes: number;
  /** GPU texture memory currently used, bytes (from the summary line, if present). */
  usedBytes: number | null;
  /** Maximum GPU texture memory, bytes (from the summary line, if present). */
  maxBytes: number | null;
  /** Available GPU texture memory, bytes (from the summary line, if present). */
  availableBytes: number | null;
}

const ROW_RE = /^0x[0-9a-f]+\b/i;
const SUMMARY_RE =
  /Available texture memory\s+(\d+)\s+used\s+(\d+)\s+max\s+(\d+)/i;

/**
 * Parses a raw `r2d2_bitmaps` response into an {@link R2d2Bitmaps}.
 *
 * Row columns are `address width height bpp size buf_sz tex fbo name`; render
 * targets print a bracketed buffer size and no name, so parsing is tolerant —
 * the first five columns are always present. The trailing summary line
 * (`Available texture memory … used … max …`) gives authoritative GPU totals.
 *
 * Returns `null` when the response contains no bitmap rows or summary (e.g. the
 * `loaded_textures only works when a Scene Graph screen is displayed` hint).
 */
export function parseR2d2Bitmaps(raw: string): R2d2Bitmaps | null {
  const text = stripConsoleResponse(raw);
  const lines = text.split('\n');

  const bitmaps: TextureBitmap[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!ROW_RE.test(trimmed)) continue;

    const cols = trimmed.split(/\s+/);
    if (cols.length < 5) continue;

    const width = Number(cols[1]);
    const height = Number(cols[2]);
    const bpp = Number(cols[3]);
    const sizeBytes = Number(cols[4]);
    if ([width, height, bpp, sizeBytes].some(Number.isNaN)) continue;

    // Columns 5..7 are buf_sz/tex/fbo; the name (if any) is the trailing path.
    const name = cols.slice(5).find((c) => c.includes('/')) ?? '';

    bitmaps.push({ address: cols[0], width, height, bpp, sizeBytes, name });
  }

  const summary = SUMMARY_RE.exec(text);
  if (bitmaps.length === 0 && !summary) return null;

  return {
    bitmaps,
    count: bitmaps.length,
    totalSizeBytes: bitmaps.reduce((sum, b) => sum + b.sizeBytes, 0),
    availableBytes: summary ? Number(summary[1]) : null,
    usedBytes: summary ? Number(summary[2]) : null,
    maxBytes: summary ? Number(summary[3]) : null,
  };
}
