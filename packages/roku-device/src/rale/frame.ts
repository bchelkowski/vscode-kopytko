/**
 * Wire framing for the RALE TrackerTask socket protocol.
 *
 * Requests (client → device):  `[start]{"uuid":…,"command":…,"args":…}[end]`
 * — the device splits its receive buffer on `[start]` and strips `[end]`
 * (SocketConnection_ParseData), then ParseJson()s each piece, so a request is
 * plain JSON inside the markers. The device reads in ~16 KB / 10 ms bursts;
 * keep individual requests small and always include `args` (handlers index
 * into it unconditionally).
 *
 * Responses (device → client): `[start][uuid:<len>]<uuid><json>[end]`,
 * written in multiple TCP packets for large payloads — the decoder buffers
 * until the closing `[end]` marker arrives.
 */

const START = '[start]';
const END = '[end]';
const UUID_HEADER = /^\[uuid:(\d+)\]/;

/** Encode a client request frame. `args` is always present — the TrackerTask
 *  command handlers dereference it without a guard. */
export function encodeRequest(uuid: string, command: string, args: object = {}): string {
  return `${START}${JSON.stringify({ uuid, command, args })}${END}`;
}

export interface RaleFrame {
  uuid: string;
  /** Parsed JSON payload; `null` when the body was not valid JSON. */
  payload: unknown;
}

/**
 * Incremental decoder for device → client frames. Feed raw socket chunks to
 * `push()`; it returns every frame completed by that chunk. Partial frames
 * (including markers split across chunk boundaries) stay buffered; bytes
 * before a `[start]` marker are discarded.
 */
export class FrameDecoder {
  private buffer = '';

  push(chunk: string): RaleFrame[] {
    this.buffer += chunk;
    const frames: RaleFrame[] = [];

    for (;;) {
      const start = this.buffer.indexOf(START);
      if (start === -1) {
        // No frame start in sight. Keep a tail in case a marker is split
        // across chunks; everything before it is noise.
        this.buffer = this.buffer.slice(-(START.length - 1));
        return frames;
      }
      const end = this.buffer.indexOf(END, start + START.length);
      if (end === -1) {
        this.buffer = this.buffer.slice(start);
        return frames;
      }

      const body = this.buffer.slice(start + START.length, end);
      this.buffer = this.buffer.slice(end + END.length);

      const frame = decodeBody(body);
      if (frame) frames.push(frame);
    }
  }

  /** Drop any partially buffered frame (used on disconnect). */
  reset(): void {
    this.buffer = '';
  }
}

function decodeBody(body: string): RaleFrame | null {
  const header = UUID_HEADER.exec(body);
  if (!header) return null;

  const uuidLen = Number(header[1]);
  const uuidStart = header[0].length;
  const uuid = body.slice(uuidStart, uuidStart + uuidLen);
  if (uuid.length !== uuidLen) return null;

  const json = body.slice(uuidStart + uuidLen);
  let payload: unknown = null;
  try {
    payload = JSON.parse(json);
  } catch {
    payload = null;
  }
  return { uuid, payload };
}
