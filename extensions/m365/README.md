# VynorAI Microsoft 365 Add-in

This development package contains the first Excel slice. It uses Entra Authorization Code + PKCE, maps an explicit user instruction to the table/chart/new-sheet/PivotTable allowlist, reads only the selected range, sends a bounded preview request to the existing VynorAI backend, and requires an approval response before Office.js writes anything. Ambiguous instructions produce no mutation plan.

After an approved apply attempt, the client sends one metadata-only result receipt containing action kinds/statuses and the source-preservation result. It never sends cell values or raw Office error text in that receipt.

Configure the task pane at runtime with `window.__VYNORAI_M365_CONFIG__`:

```js
{
  tenantId: "<Entra tenant ID>",
  clientId: "<public SPA client application ID>",
  redirectUri: "https://<add-in-host>/taskpane.html",
  scopes: ["api://<API-client-id>/m365.excel.read", "api://<API-client-id>/m365.excel.write"],
  graphScopes: ["https://graph.microsoft.com/Mail.Send"], // requested only after Send approval
  graphLargeScopes: ["https://graph.microsoft.com/Mail.Send", "https://graph.microsoft.com/Mail.ReadWrite"], // optional large/draft delivery
  apiBaseUrl: "https://<vynorai-api-host>"
}
```

For local testing, copy `runtime-config.example.js` to `runtime-config.js` and replace only the IDs and URLs.
The client ID and tenant ID are not secrets; never put a client secret in this file.

The local page must be HTTPS. Generate trusted development certificates with `npx office-addin-dev-certs install`,
copy the generated `localhost.crt` and `localhost.key` into this directory, build with `npm run build`, start the
backend on port 3333, then run `npm run dev-server`. The dev server serves the task pane on port 3000 and proxies
`/v1/*` to the backend, so the browser does not make a mixed-content HTTP request.

## Browser pane smoke test

Run `npm run test:ui` to build the pane and open it in a local headless Chrome instance. The test supplies a
deterministic Office.js selection and local capability response, then checks the narrow task-pane layout, menu,
selection refresh, enabled Run control, horizontal overflow and click reachability. It writes screenshots to the
ignored `test-artifacts/` directory.

The test uses the installed Chrome/Edge executable, or `M365_UI_CHROME_PATH` when a CI image keeps it elsewhere.
It is a browser-layout regression test, not an Excel Web end-to-end test: it neither signs in to Microsoft nor
writes to a workbook. Before a release, still open the add-in in Excel for the web and Excel Desktop and complete
the manual preview, approval, apply, verification and undo smoke checks.

No client secret belongs in this package. `manifest.xml` is development-only and must pass host/URL/permission review before tenant deployment.

## Production static host

The production manifest uses `https://vynor.lk/m365/taskpane.html`. OAuth runs in the Office Dialog API and returns to
`https://vynor.lk/m365/auth-callback.html`. Build locally with `npm run build`, then publish `taskpane.html`,
`auth-dialog.html`, `auth-callback.html`, `manifest.xml`, `dist/` (including the single `taskpane.bundle.js`), `logo.png`, and a copy of `runtime-config.production.js` named
`runtime-config.js` to the VPS `extensions/m365/` directory before Caddy reload. The runtime configuration contains
public Entra IDs only; backend secrets remain in the server's `backend/.env`.

The task pane uses a browser-compatible bundle. An unexpired sign-in access token is kept only in this add-in origin's
local storage, is never logged, and can be removed with **Sign out**. Test on a current Microsoft 365 Apps / WebView2
Excel client, or use Excel for the web when a legacy desktop Excel webview reports that it cannot start the add-in.

After a report is applied, the **Email report** panel can deliver an `.xlsx`, `.pdf`, `.csv`, combined XLSX/PDF,
or summary-only report. It can add bounded report details and up to three report charts as HTML inline images.
The recipient, format, body and attachment list are reviewed in the pane, then a second confirmation requests
Microsoft Graph consent and sends directly to `/me/sendMail`; report bytes are not uploaded to VynorAI or written
to its logs. Small messages use direct send; larger attachments use a resumable Outlook draft upload session when
`Mail.ReadWrite` is configured. Microsoft tenant/message limits still apply and are surfaced as explicit errors.

## How updates reach users

An Office add-in is a manifest plus a web app. Only the manifest is installed; everything the user sees
(`taskpane.html`, `dist/taskpane.bundle.js`, `runtime-config.js`) is loaded from `https://vynor.lk/m365/` every time the
task pane opens. Caddy serves it with `Cache-Control: no-store`, and each opening cache-busts the tiny generated
`build-id.js` before using its value in the runtime-config and bundle URLs. Both safeguards prevent a reopened Excel
WebView from using an earlier bundle without modifying tracked HTML on the VPS.

- **UI, logic, backend and styling changes:** publish the static files (see `deploy/publish-m365.sh`). Users get them the
  next time they open the task pane; an already open pane must be closed and opened again because Office does not hot-reload
  a running page. Nothing is downloaded or re-added.
- **Manifest changes** (new host, permission, domain, icon, `SourceLocation`) are rare and are the only thing that needs a
  re-upload. Before uploading, run `npm run validate-manifests` in `extensions/m365` (Microsoft's validator, needs internet);
  `src/manifest.test.ts` checks the same structure offline. Bump `<Version>` in every manifest you change, or the admin
  center will not see an update. Keep the manifest minimal and never put a cache-busting `?v=` in `SourceLocation`.
- **Distribution:** sideloading is for development only. For real users deploy once through Microsoft 365 admin center
  (Integrated apps, Centralized Deployment) so the manifest is pushed to assigned users or groups and later manifest
  updates reach them without manual downloads.
- The menu (`...`) shows the loaded build id, so a user can confirm which version is running.

## Other Office apps

`text.html` and `src/text.ts` provide writing assistance (summarize, rewrite, fix grammar, translate to
Sinhala or English, draft a reply) for Word, PowerPoint and Outlook. Each app has its own manifest:
`manifest-word.xml`, `manifest-powerpoint.xml`, `manifest-outlook.xml`. The text is sent only after the person
ticks a consent box, is limited to 8000 characters, passes the shared PII shield, and the answer must match a
strict schema. Inserting is additive (Word: after the selection; Outlook: top of a draft). PowerPoint is copy
only, and nothing is ever sent as an email. The API scopes are `m365.text.read` and `m365.text.write`.
