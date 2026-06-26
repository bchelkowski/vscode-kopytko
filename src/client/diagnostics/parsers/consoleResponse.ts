/**
 * Helpers for cleaning raw responses from the Roku SceneGraph debug server
 * (TCP port 8080).
 *
 * A raw response looks like:
 *
 * ```
 * X02800C5FKLV (Roku Ultra - 15.2.4.3442)
 * >channel: mem=53920KiB{...},%cpu=0{...}
 * >
 * ```
 *
 * The first line is a one-time connection banner; `>` is the interactive prompt
 * which is glued to the start of the command output and repeated as a trailing
 * prompt. Parsers operate on the cleaned payload, so we strip the banner and the
 * leading/trailing prompts here.
 *
 * Note: XML responses contain `>` throughout, so the prompt cannot be used as a
 * generic delimiter — that framing is handled by idle detection in the
 * transport layer. This function only trims the well-known wrapper.
 */

const BANNER_LINE = /^[^\n]*\(Roku[^\n]*\)\r?\n/;

/**
 * Strips the connection banner and the leading/trailing interactive `>` prompts
 * from a raw debug-console response, returning the bare payload.
 */
export function stripConsoleResponse(raw: string): string {
  let s = raw.replace(/\r\n/g, '\n');

  // Drop the one-time device banner line, if present.
  s = s.replace(BANNER_LINE, '');

  // Drop a leading prompt that is glued to the first output line (`>channel:` /
  // `><sg-nodes>`), including any prompts left over from connect.
  s = s.replace(/^[ \t]*>+/, '');

  // Drop the trailing prompt the device prints after the output.
  s = s.replace(/\n[ \t]*>+[ \t]*$/, '');

  return s.trim();
}

/**
 * Returns true when a debug-console response is a `Usage: …` hint rather than
 * real data (the device prints these for incomplete/invalid commands).
 */
export function isUsageResponse(payload: string): boolean {
  return /^usage:/i.test(payload.trimStart());
}
