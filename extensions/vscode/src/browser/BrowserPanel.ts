/**
 * "VynorAI Browser": a live view of the agent's browser inside the editor.
 * Works in VS Code and every fork (Antigravity, Cursor, Windsurf, Qoder).
 *
 * Frames come from the shared browser session's screencast. The user can
 * type a URL, click, scroll and type into the page, and read console and
 * network errors, while the agent drives the same browser.
 */
import { browserSession } from "core/tools/browser/session";
import * as vscode from "vscode";

let panel: vscode.WebviewPanel | undefined;

function nonce(): string {
  let s = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function html(webview: vscode.Webview): string {
  const n = nonce();
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<style>
  body { margin:0; padding:0; font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); background: var(--vscode-editor-background); display:flex; flex-direction:column; height:100vh; }
  .bar { display:flex; gap:4px; padding:6px; border-bottom:1px solid var(--vscode-panel-border); align-items:center; }
  .bar button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border:none; border-radius:3px; padding:3px 8px; cursor:pointer; }
  .bar input { flex:1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border:1px solid var(--vscode-input-border, transparent); border-radius:3px; padding:4px 6px; }
  .view { flex:1; overflow:auto; position:relative; background:#111; display:flex; justify-content:center; align-items:flex-start; }
  #screen { max-width:100%; cursor:pointer; outline:none; }
  .empty { color: var(--vscode-descriptionForeground); padding:40px; text-align:center; line-height:1.6; }
  .logs { height:28%; min-height:80px; overflow:auto; border-top:1px solid var(--vscode-panel-border); font-family: var(--vscode-editor-font-family); font-size:11px; }
  .logs .h { position:sticky; top:0; background: var(--vscode-editor-background); padding:4px 6px; color: var(--vscode-descriptionForeground); display:flex; justify-content:space-between; }
  .logs div.l { padding:2px 6px; white-space:pre-wrap; word-break:break-all; border-bottom:1px solid rgba(128,128,128,0.08); }
  .error { color: var(--vscode-errorForeground); } .warn, .warning { color: var(--vscode-editorWarning-foreground); }
</style></head>
<body>
  <div class="bar">
    <button id="back" title="Back">←</button>
    <button id="reload" title="Reload">⟳</button>
    <input id="url" placeholder="http://localhost:3000" spellcheck="false">
    <button id="go">Go</button>
    <button id="close" title="Close browser">✕</button>
  </div>
  <div class="view" id="view">
    <div class="empty" id="empty">No page open.<br>Type a URL above, or ask the VynorAI agent to test a page.<br>You can click, scroll and type in the page here while the agent works.</div>
    <img id="screen" tabindex="0" style="display:none" alt="Browser view">
  </div>
  <div class="logs" id="logs"><div class="h"><span>Console &amp; network</span><a href="#" id="clear">clear</a></div></div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const img = document.getElementById('screen'), empty = document.getElementById('empty');
  const url = document.getElementById('url'), logs = document.getElementById('logs');
  let size = { width: 1280, height: 800 };
  const post = (m) => vscode.postMessage(m);
  document.getElementById('go').onclick = () => post({ type: 'navigate', url: url.value });
  url.onkeydown = (e) => { if (e.key === 'Enter') post({ type: 'navigate', url: url.value }); };
  document.getElementById('back').onclick = () => post({ type: 'back' });
  document.getElementById('reload').onclick = () => post({ type: 'reload' });
  document.getElementById('close').onclick = () => post({ type: 'close' });
  document.getElementById('clear').onclick = (e) => { e.preventDefault(); logs.querySelectorAll('.l').forEach((n) => n.remove()); };
  img.onclick = (e) => {
    const r = img.getBoundingClientRect();
    post({ type: 'click', x: (e.clientX - r.left) * size.width / r.width, y: (e.clientY - r.top) * size.height / r.height });
    img.focus();
  };
  img.onwheel = (e) => { e.preventDefault(); post({ type: 'scroll', dy: e.deltaY }); };
  img.onkeydown = (e) => {
    e.preventDefault();
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) post({ type: 'text', text: e.key });
    else post({ type: 'key', key: e.key });
  };
  function addLog(l) {
    const d = document.createElement('div');
    d.className = 'l ' + l.level;
    d.textContent = '[' + l.kind + '] ' + l.text;
    logs.appendChild(d);
    while (logs.querySelectorAll('.l').length > 300) logs.querySelector('.l').remove();
    logs.scrollTop = logs.scrollHeight;
  }
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'frame') {
      size = { width: m.width, height: m.height };
      img.src = 'data:image/jpeg;base64,' + m.data;
      img.style.display = 'block'; empty.style.display = 'none';
    } else if (m.type === 'state') {
      if (m.url && document.activeElement !== url) url.value = m.url;
      if (!m.open) { img.style.display = 'none'; empty.style.display = 'block'; }
    } else if (m.type === 'log') addLog(m.entry);
    else if (m.type === 'logs') m.entries.forEach(addLog);
    else if (m.type === 'error') addLog({ kind: 'panel', level: 'error', text: m.text });
  });
  post({ type: 'ready' });
</script>
</body></html>`;
}

async function handle(msg: any): Promise<void> {
  try {
    switch (msg?.type) {
      case "ready":
        if (browserSession.frame)
          void panel?.webview.postMessage({
            type: "frame",
            ...browserSession.frame,
          });
        void panel?.webview.postMessage({
          type: "state",
          open: browserSession.isOpen,
          url: browserSession.currentUrl,
        });
        void panel?.webview.postMessage({
          type: "logs",
          entries: browserSession.getLogs(undefined, 100),
        });
        break;
      case "navigate":
        if (String(msg.url ?? "").trim())
          await browserSession.navigate(String(msg.url).trim());
        break;
      case "back":
        await browserSession.back();
        break;
      case "reload":
        await browserSession.reload();
        break;
      case "close":
        await browserSession.close();
        break;
      case "click":
        if (browserSession.isOpen)
          await browserSession.clickAt(Number(msg.x), Number(msg.y));
        break;
      case "scroll":
        if (browserSession.isOpen)
          await browserSession.scroll(Number(msg.dy) || 0);
        break;
      case "text":
        if (browserSession.isOpen)
          await browserSession.typeText(String(msg.text ?? ""));
        break;
      case "key":
        if (browserSession.isOpen)
          await browserSession.press(String(msg.key ?? ""));
        break;
    }
  } catch (e: any) {
    void panel?.webview.postMessage({
      type: "error",
      text: e?.message ?? String(e),
    });
  }
}

export function showBrowserPanel(preserveFocus = false): void {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside, preserveFocus);
    return;
  }
  panel = vscode.window.createWebviewPanel(
    "vynorai.browser",
    "VynorAI Browser",
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus },
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = html(panel.webview);
  panel.webview.onDidReceiveMessage((m) => void handle(m));
  panel.onDidDispose(() => (panel = undefined));
}

export function setupBrowserPanel(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("vynorai.openBrowser", () =>
      showBrowserPanel(),
    ),
  );
  const onFrame = (frame: any) =>
    void panel?.webview.postMessage({ type: "frame", ...frame });
  const onLog = (entry: any) =>
    void panel?.webview.postMessage({ type: "log", entry });
  const onState = (state: any) => {
    // When the agent opens the browser, show it beside the editor without
    // taking focus away from the chat.
    if (state.launched && !panel) showBrowserPanel(true);
    void panel?.webview.postMessage({ type: "state", ...state });
  };
  browserSession.on("frame", onFrame);
  browserSession.on("log", onLog);
  browserSession.on("state", onState);
  context.subscriptions.push({
    dispose: () => {
      browserSession.off("frame", onFrame);
      browserSession.off("log", onLog);
      browserSession.off("state", onState);
      void browserSession.close();
    },
  });
}
