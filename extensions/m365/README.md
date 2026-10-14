# VynorAI Microsoft 365 Add-in

This development package contains the first Excel slice. It uses Entra Authorization Code + PKCE, reads only the selected range, sends a bounded preview request to the existing VynorAI backend, and requires an approval response before Office.js writes a table, chart, result sheet, or PivotTable.

Configure the task pane at runtime with `window.__VYNORAI_M365_CONFIG__`:

```js
{
  tenantId: "<Entra tenant ID>",
  clientId: "<public SPA client application ID>",
  redirectUri: "https://<add-in-host>/taskpane.html",
  scopes: ["api://<API-client-id>/m365.excel.read", "api://<API-client-id>/m365.excel.write"],
  apiBaseUrl: "https://<vynorai-api-host>"
}
```

For local testing, copy `runtime-config.example.js` to `runtime-config.js` and replace only the IDs and URLs.
The client ID and tenant ID are not secrets; never put a client secret in this file.

The local page must be HTTPS. Generate trusted development certificates with `npx office-addin-dev-certs install`,
copy the generated `localhost.crt` and `localhost.key` into this directory, build with `npm run build`, start the
backend on port 3333, then run `npm run dev-server`. The dev server serves the task pane on port 3000 and proxies
`/v1/*` to the backend, so the browser does not make a mixed-content HTTP request.

No client secret belongs in this package. `manifest.xml` is development-only and must pass host/URL/permission review before tenant deployment.

## Production static host

The production manifest uses `https://vynor.lk/m365/taskpane.html`. OAuth runs in the Office Dialog API and returns to
`https://vynor.lk/m365/auth-callback.html`. Build locally with `npm run build`, then publish `taskpane.html`,
`auth-dialog.html`, `auth-callback.html`, `manifest.xml`, `dist/`, `logo.png`, and a copy of `runtime-config.production.js` named
`runtime-config.js` to the VPS `extensions/m365/` directory before Caddy reload. The runtime configuration contains
public Entra IDs only; backend secrets remain in the server's `backend/.env`.

The task pane uses modern browser modules. Test on a current Microsoft 365 Apps / WebView2 Excel client, or use Excel
for the web when a legacy desktop Excel webview reports that it cannot start the add-in.
