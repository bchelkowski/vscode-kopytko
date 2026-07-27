/**
 * Classifies a single line of Roku debug-console output into a severity and a
 * list of coloured spans.
 *
 * Deliberately free of `vscode` and DOM imports: this module is bundled into
 * the console webview by esbuild *and* compiled by tsc for the unit tests, so
 * it must stay pure. All patterns are derived from output captured against a
 * real device — see `findings/roku-device-api.md` for the raw samples.
 */

/**
 * Line-level classification, used to pick the base colour.
 *
 * There is deliberately no `rendezvous` class: `logrendezvous on` was verified
 * live against a Roku Ultra (firmware 15.2.4.3442) to emit nothing on either
 * port 8085 or 8080. Rendezvous data reaches the extension over ECP
 * (`/query/sgrendezvous`) and belongs to the Diagnostics panel, not here.
 */
export type Severity =
  | 'error'
  | 'warning'
  | 'beacon'
  | 'debugger'
  | 'xml'
  | 'plain';

/** Sub-line token classification, used to highlight parts of a line. */
export type SpanKind =
  | 'text'
  | 'timestamp'
  | 'thread'
  | 'source'
  | 'metric'
  | 'tag'
  | 'prompt';

export interface Span {
  kind: SpanKind;
  text: string;
}

/** A `pkg:/…(line)` reference, resolvable to a workspace file. */
export interface SourceRef {
  /** Path as printed by the device, e.g. `pkg:/components/Foo.brs`. */
  pkgPath: string;
  /** 1-based line number. */
  line: number;
}

export interface ClassifiedLine {
  severity: Severity;
  spans: Span[];
  /** First source reference found on the line, if any. */
  sourceRef?: SourceRef;
}

// ── severity patterns ───────────────────────────────────────────────────────

const DEBUGGER_PROMPT = /^\s*(?:Brightscript|BrightScript)\s+Debugger>/i;
const DEBUGGER_CONTEXT = /^\s*(?:Current Function:|Local Variables:|#\d+\s)/;

const ERROR_PATTERNS = [
  /BRIGHTSCRIPT:\s*ERROR/i,
  /\*{3}\s*ERROR/i,
  /\bSyntax Error\b/i,
  /\bType Mismatch\b/i,
  /\bRuntime Error\b/i,
  /\bBacktrace:/i,
  /\bERROR:/,
  /\bcrash(?:ed)?\b/i,
  // Bracketed level tags — the convention Roku app loggers use in practice,
  // e.g. `[Failed.NetworkRequestHandler] |…` (seen live on port 8085).
  /^\s*\[(?:Error|Failed|Failure|Fatal)[\w.]*\]/i,
];

const WARNING_PATTERNS = [
  /BRIGHTSCRIPT:\s*WARNING/i,
  /\bWARNING:/i,
  /\bUnable to\b/i,
  /\bdeprecated\b/i,
  /^\s*\[(?:Warning|Warn)[\w.]*\]/i,
];

const BEACON_PATTERNS = [
  /\[beacon\.signal\]/i,
  /\b(?:App|Vod|VOD|Channel)[A-Za-z]*(?:Initiate|Complete)\b/,
  /\bapp-(?:launch|suspend|resume|splash|compile)-(?:initiate|complete)\b/i,
];

const XML_LINE = /^\s*<[?/A-Za-z]/;

// ── span patterns ───────────────────────────────────────────────────────────

/** Device log prefix: `06-26 07:24:26.305 app ` — timestamp plus thread tag. */
const LOG_PREFIX = /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})(\s+)([a-z]{2,6})\b/;

/** `pkg:/components/Foo.brs(40)`, and the bare `Foo.brs(40)` form 8085 also prints. */
const SOURCE_REF = /((?:pkg:\/)?[\w./-]+\.(?:brs|xml))\((\d+)\)/gi;

/** Numbers carrying a unit: `53920KiB`, `1.5ms`, `0%`. */
const METRIC = /\b\d+(?:\.\d+)?(?:KiB|MiB|GiB|kB|MB|GB|ms|%)\b/g;

/** XML tag delimiters, so 8080's XML replies read as structure not prose. */
const XML_TAG = /<\/?[\w:.-]+|\/?>/g;

/** The device's own prompt, kept visible in terminal mode. */
const PROMPT = /^\s*>+/;

interface Match {
  start: number;
  end: number;
  kind: SpanKind;
}

/**
 * Classify one line of console output.
 *
 * The line must not contain newlines — callers assemble chunks into lines
 * first. A trailing `\r` is tolerated and preserved in the span text.
 */
export function classifyLine(raw: string): ClassifiedLine {
  const severity = detectSeverity(raw);
  const matches = collectMatches(raw, severity);
  return {
    severity,
    spans: buildSpans(raw, matches),
    sourceRef: findSourceRef(raw),
  };
}

function detectSeverity(line: string): Severity {
  if (DEBUGGER_PROMPT.test(line) || DEBUGGER_CONTEXT.test(line)) return 'debugger';
  // Errors and warnings win over beacons: a warning *about* a beacon
  // ("initiate before signaling AppResumeComplete") is a warning, not a beacon.
  if (ERROR_PATTERNS.some((re) => re.test(line))) return 'error';
  if (WARNING_PATTERNS.some((re) => re.test(line))) return 'warning';
  if (BEACON_PATTERNS.some((re) => re.test(line))) return 'beacon';
  if (XML_LINE.test(line)) return 'xml';
  return 'plain';
}

function collectMatches(line: string, severity: Severity): Match[] {
  const matches: Match[] = [];

  const prompt = PROMPT.exec(line);
  if (prompt && prompt[0].length > 0) {
    matches.push({ start: 0, end: prompt[0].length, kind: 'prompt' });
  }

  if (DEBUGGER_PROMPT.test(line)) {
    const end = line.indexOf('>') + 1;
    if (end > 0) matches.push({ start: 0, end, kind: 'prompt' });
  }

  const prefix = LOG_PREFIX.exec(line);
  if (prefix) {
    const tsEnd = prefix[1].length;
    matches.push({ start: 0, end: tsEnd, kind: 'timestamp' });
    const threadStart = tsEnd + prefix[2].length;
    matches.push({ start: threadStart, end: threadStart + prefix[3].length, kind: 'thread' });
  }

  pushAll(matches, line, SOURCE_REF, 'source');
  pushAll(matches, line, METRIC, 'metric');
  // Only decorate tags on lines that actually are markup; a stray `<` in a
  // print statement should not turn the line into pseudo-XML.
  if (severity === 'xml') pushAll(matches, line, XML_TAG, 'tag');

  return resolveOverlaps(matches);
}

function pushAll(into: Match[], line: string, pattern: RegExp, kind: SpanKind): void {
  // Patterns are module-level and /g, so reset lastIndex before each use.
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(line)) !== null) {
    if (m[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    into.push({ start: m.index, end: m.index + m[0].length, kind });
  }
}

/** Sort by position and drop any match overlapping an earlier-kept one. */
function resolveOverlaps(matches: Match[]): Match[] {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Match[] = [];
  let cursor = 0;
  for (const match of sorted) {
    if (match.start < cursor) continue;
    kept.push(match);
    cursor = match.end;
  }
  return kept;
}

function buildSpans(line: string, matches: Match[]): Span[] {
  if (line.length === 0) return [];
  if (matches.length === 0) return [{ kind: 'text', text: line }];

  const spans: Span[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      spans.push({ kind: 'text', text: line.slice(cursor, match.start) });
    }
    spans.push({ kind: match.kind, text: line.slice(match.start, match.end) });
    cursor = match.end;
  }
  if (cursor < line.length) spans.push({ kind: 'text', text: line.slice(cursor) });
  return spans;
}

function findSourceRef(line: string): SourceRef | undefined {
  SOURCE_REF.lastIndex = 0;
  const m = SOURCE_REF.exec(line);
  if (!m) return undefined;
  const lineNumber = Number(m[2]);
  if (!Number.isFinite(lineNumber) || lineNumber <= 0) return undefined;
  return { pkgPath: m[1], line: lineNumber };
}
