/** Returns the element with the given id, cast to `T`. */
export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** HTML-escapes `&`, `<`, `>`, and `"` via the browser's own DOM serializer. */
export function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/** Formats a byte count as `B`/`KB`/`MB`, MB rounded to 2 decimal places. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
