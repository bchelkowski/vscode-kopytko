import * as vscode from 'vscode';

export interface WebviewHtmlOptions {
  /** Subdirectory of `out/` holding this webview's bundled `main.js`/`main.css`. */
  outDir: string;
  title: string;
  /** Extra CSP directives appended after the standard set (e.g. `frame-src https://ui.perfetto.dev;`). */
  extraCsp?: string;
  /** Set false to omit `img-src` (a webview with no images, e.g. the nav sidebar). Defaults to true. */
  includeImgSrc?: boolean;
  /** Markup inserted into `<body>` before the script tag. Defaults to none (script tag only). */
  bodyContent?: string;
  /** Extra attributes on the `<body>` tag itself, e.g. `data-view="${kind}"`. */
  bodyAttrs?: string;
}

/**
 * Builds the standard CSP-locked HTML shell shared by every webview tool:
 * doctype, meta/CSP head, stylesheet link, title, and a trailing script tag
 * pointing at the webview's bundled `main.js`.
 */
export function buildWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  opts: WebviewHtmlOptions,
): string {
  const outDir = vscode.Uri.joinPath(context.extensionUri, 'out', opts.outDir);
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(outDir, 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(outDir, 'main.css'));
  const csp = webview.cspSource;
  const includeImgSrc = opts.includeImgSrc ?? true;

  const cspDirectives = [
    "default-src 'none';",
    `style-src ${csp} 'unsafe-inline';`,
    `script-src ${csp};`,
    includeImgSrc ? `img-src ${csp} data:;` : undefined,
    opts.extraCsp,
  ].filter(Boolean).join(' ');

  const scriptTag = `<script src="${scriptUri}"></script>`;
  const body = opts.bodyContent ? `${opts.bodyContent}\n  ${scriptTag}` : `  ${scriptTag}`;
  const bodyTag = opts.bodyAttrs ? `<body ${opts.bodyAttrs}>` : '<body>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="${cspDirectives}">
  <link href="${styleUri}" rel="stylesheet">
  <title>${opts.title}</title>
</head>
${bodyTag}
${body}
</body>
</html>`;
}
