# VynorAI Microsoft 365 Copilot Add-in Plan

Status: Phase 0/1 safe Excel slice and multitenant Entra registration preparation completed. The production registrations expose only the Excel read/write delegated scopes and use an HTTPS production task-pane redirect URI. No production add-in deployment is enabled by this document. Real Excel-host sign-in and workbook evidence remains pending an eligible Microsoft 365 user/license.

Local OAuth prerequisites are `M365_ENTRA_TENANT_ID`, `M365_ENTRA_API_CLIENT_ID`, `M365_ENTRA_CLIENT_ID`, and optionally
`M365_ENTRA_ISSUER`/`M365_ENTRA_JWKS_URL`. Production multitenant mode additionally sets `M365_ENTRA_MULTI_TENANT=true`;
the browser then uses the `organizations` authority and the backend validates a tenant-specific v2 issuer, API audience,
approved client ID, and required scope. Every Entra `{tid, oid}` must first be explicitly bound in
`m365_identity_links`; an OAuth token alone never creates a VynorAI account binding. The add-in uses
Authorization Code + PKCE and never stores a client secret.

Production M365 access additionally requires an enabled row in `m365_tenants`; each tenant has an independently
configured allowed-action scope list and consent timestamp. The existing admin API exposes `/admin/m365/tenants` for
enablement/revocation and `/admin/m365/identities/:tenantId/:objectId` for an explicit VynorAI-account identity binding.

For a controlled test binding, run `npx tsx scripts/link-m365-identity.ts` from `backend/` with
`M365_LINK_TENANT_ID`, `M365_LINK_OBJECT_ID`, and the existing VynorAI internal `M365_LINK_USER_ID` set only in
the local shell. The script prints no identifier or token.

The add-in is a sub-product of this VynorAI monorepo. It is not a separate repository or an independent copy of the backend.

## Goal

Build a VynorAI-powered Microsoft 365 experience that can assist in Word, Excel, Outlook, and Microsoft 365 Copilot while keeping model access, billing, tenant isolation, approvals, and audit controls in the VynorAI backend.

The first release is a focused assistant, not a replacement for Microsoft Copilot. It must provide useful document, spreadsheet, and email workflows with explicit confirmation before any write or send operation.

## Monorepo placement

The implementation belongs under `extensions/m365/` as a sibling of `extensions/vscode/`, `extensions/intellij/`, and `extensions/cli/`.

- `extensions/m365/`: Office.js web app, Microsoft 365 manifests, Entra client integration, and M365-specific UI.
- `backend/src/routes/m365.ts`: server-side M365 session and action endpoints, after the existing auth and policy middleware.
- `backend/src/services/m365Policy.ts`: tenant, scope, approval, retention, and action policy enforcement.
- `packages/`: only genuinely reusable contracts or validation schemas shared by the add-in and backend.
- Existing model routing, credits, audit, cache, security, and provider code remain in their current modules.

Do not copy the VS Code extension, create a second model gateway, or put provider secrets in `extensions/m365/`.

## Microsoft 365 Add-in contents

The M365 sub-add-in must contain the following parts before it is considered complete.

### Client application

- A responsive Office.js task-pane UI for Word, Outlook, and later Excel.
- Sign-in, sign-out, session-expiry, consent, loading, rate-limit, and offline states.
- Context picker showing exactly what Office content is being sent to VynorAI.
- Actions for summarize, rewrite, translate, extract tasks, and draft generation.
- A preview/diff view before inserting text, creating a draft, or changing a document.
- Explicit confirmation buttons for every write, send, create, or delete operation.
- Accessibility support, keyboard navigation, high-contrast behavior, and clear Sinhala/English labels.

### Microsoft app package

- Versioned Office Add-in manifest with the least-privilege permissions required by the first workflow.
- App icons, display name, descriptions, support URL, privacy URL, terms URL, and publisher metadata.
- Entra ID application/client configuration references without embedded secrets.
- A separate declarative-agent manifest for Microsoft 365 Copilot, when the agent phase is enabled.
- A plugin manifest and OpenAPI reference containing only allowlisted VynorAI operations.
- Package validation that rejects unknown hosts, insecure URLs, broad permissions, missing privacy links, and mismatched versions.

### Backend integration

- M365-specific routes that reuse the existing VynorAI authentication, quota, billing, routing, cache, and audit services.
- Entra token validation and `{tenantId, objectId}` identity mapping.
- Tenant-scoped authorization for document, mail, calendar, and spreadsheet context.
- Read, draft, write, and send scopes enforced separately.
- Request-size, attachment-type, timeout, model-credit, and tool allowlists.
- Approval tokens for mutations so a stale preview cannot be applied after the document changes.
- Redacted audit events containing tenant/user IDs, operation IDs, result status, and cost—not raw document content or tokens.

### Shared API contracts

- Versioned TypeScript request/response schemas in `packages/` where both client and backend need the same contract.
- Stable OpenAPI `operationId` values for every Copilot action.
- Structured responses containing result text, citations/context references, warnings, and an optional approval token.
- Typed error codes for consent required, insufficient scope, tenant disabled, quota exceeded, policy denied, and provider failure.
- Correlation IDs that travel from the Office client through the backend and into the audit ledger.

### Verification assets

- Unit tests for manifest and OpenAPI validation, token claims, tenant isolation, scope checks, approval expiry, and redaction.
- Contract tests between `extensions/m365` and the backend.
- Real test-tenant E2E tests for Word read, Word preview/insert, Outlook read/draft, sign-out, consent denial, token expiry, and cross-tenant denial.
- Prompt-injection and malicious-document fixtures.
- Accessibility and browser/client compatibility checks.
- A fixed quality/cost task set with pass rate, latency, credits, and provider cost recorded.

### Distribution artifacts

The release pipeline must produce separate signed artifacts and an optional bundle:

```text
vynorai-m365-<version>.zip       # M365 manifest, agent/plugin package, icons, and install guide
vynorai-<version>.vsix           # VS Code extension, released by the existing VSIX pipeline
vynorai-suite-<version>.zip     # both artifacts, checksums, version manifest, and admin/user guides
```

The suite bundle is a coordinated download, not a single install file. Microsoft 365 admins can deploy only the M365 package, while developers can install both products against the same VynorAI account and backend.

### Operations and administration

- Admin view for tenant connection status, consent state, enabled actions, usage, credits, failures, and estimated cost.
- Tenant-level enable/disable switch and emergency revoke of the Entra application or action scopes.
- Versioned migration and rollback instructions for manifests and backend contracts.
- Privacy, data retention, deletion, support, and incident-response documents shipped with the package.

## Product surfaces

### Surface A: Office Add-in (MVP)

- Word: summarize, rewrite, translate, extract action items, and insert a user-approved result.
- Outlook: summarize a thread, draft a reply, and create a task; sending remains user-confirmed.
- Excel: explain a selected range, identify trends, and generate a user-approved formula or chart description.
- Shared VynorAI side panel and conversation history scoped to the signed-in user and tenant.

#### Excel prompt-to-workbook actions

An Excel prompt may produce a structured execution plan and, after user confirmation, perform these actions through the Excel JavaScript API:

- Detect the selected or named data range and validate headers, types, blanks, and duplicate keys.
- Convert a clean range into a named Excel Table with filters and a total row when requested.
- Create a new worksheet for a result, summary, chart data, or PivotTable instead of overwriting the source sheet.
- Create and format charts with a declared chart type, source range, title, axes, legend, and number formats.
- Create a PivotTable with declared row, column, filter, and value fields; add slicers where the target client supports them.
- Add formulas, conditional formatting, freeze panes, data validation, and a short assumptions/quality report.
- Return an action summary containing created sheet/table/chart/PivotTable names and any rows or fields that were skipped.

The add-in must show the proposed workbook changes before applying them. Destructive changes, source-range replacement, external links, and refresh/send operations require a separate confirmation.

#### Large-data boundary

“Big data” support means bounded, measurable processing—not blindly loading an entire data lake into Excel. The add-in must:

- profile row/column counts before reading;
- process large ranges in chunks and write values before formatting;
- aggregate, filter, or sample in the VynorAI backend when the raw dataset is too large;
- write only the requested result or a bounded extract into the workbook;
- show progress, partial-result status, and a clear limit/error when the request exceeds policy;
- preserve source data and offer a refreshable result when a stable source connection is available.

The initial Excel target is tables, charts, new worksheets, and ordinary PivotTables. OLAP/Power Pivot and unlimited in-workbook data-lake querying are explicitly out of scope until a separate compatibility and performance proof is completed.

### Surface B: Microsoft 365 Copilot declarative agent

- A separate declarative-agent package with VynorAI instructions, conversation starters, and API-plugin actions.
- The agent calls only the allowlisted VynorAI OpenAPI operations.
- The agent is distributed to a test tenant first, then through the tenant catalog or an approved marketplace route.

The two surfaces share backend contracts and policy enforcement, but neither trusts the other for authorization.

## Target architecture

```text
Office.js Add-in / Microsoft 365 Copilot Agent
                    |
          Entra ID OAuth access token
                    |
             VynorAI API Gateway
                    |
     tenant + user + scope + policy checks
                    |
       model routing, tools, credits, audit
                    |
              approved model provider
```

The add-in never contains a VynorAI secret or provider key. Graph calls that need user data are made through a server-side, least-privilege path or a documented delegated-token flow; tokens and document contents are not written to logs.

## Implementation phases

### Phase 0: Feasibility and tenant prerequisites

- Confirm a Microsoft 365 developer/test tenant, Copilot entitlement for agent testing, Entra admin consent, and supported target clients.
- Decide the first workflow: Word summarize/rewrite plus Outlook draft reply.
- Record data residency, retention, supported languages, and paid/free plan behavior.
- Write a threat model and permission matrix before registering an application.

Exit evidence: signed decision record, test-tenant owner, workflow acceptance examples, and a permission list containing no broad permissions by default.

### Phase 1: Backend identity and tenant boundary

- Add Entra ID JWT validation with issuer, audience, tenant, expiry, and nonce checks.
- Map `{tenantId, objectId}` to a VynorAI account without trusting email as identity.
- Add tenant-scoped rate limits, credit accounting, request correlation IDs, and audit events.
- Add explicit scopes for read, draft, write, and send operations.
- Make all new endpoints deny by default when tenant context or required consent is absent.

Exit evidence: unit tests for invalid issuer/audience, cross-tenant access, expired tokens, missing scopes, replayed requests, and credit-limit enforcement.

### Phase 2: VynorAI M365 API contract

- Design versioned endpoints for context, summarize, rewrite, draft, and approved actions.
- Publish a minimal OpenAPI document with stable `operationId` values and bounded request/response schemas.
- Enforce payload size, attachment type, timeout, model budget, and tool allowlists at the server.
- Return structured citations and an approval token for mutations; never accept arbitrary shell/tool instructions from the client.

Exit evidence: OpenAPI validation, contract tests, abuse tests, and a generated API-plugin manifest that contains only approved operations.

### Phase 3: Office Add-in MVP

- Create the existing product's M365 add-in package using a unified manifest where supported and a web application hosted under a separate origin.
- Implement Entra sign-in, Office.js context extraction, streaming response UI, and explicit insert/draft confirmation.
- Add Word first; add Outlook only after the Word flow passes privacy and permission review.
- Add offline/error states and a clear indicator when content leaves the Office client.

Exit evidence: real Word and Outlook tests in the developer tenant, with read-only, approved-write, denied-permission, sign-out, and token-expiry cases.

### Phase 4: Declarative Copilot agent

- Create the agent manifest, plugin manifest, OpenAPI reference, instructions, and conversation starters.
- Keep actions idempotent where possible and require confirmation for mutations.
- Test orchestration with normal, ambiguous, unsafe, and prompt-injection prompts.
- Verify admin visibility, sharing scope, and tenant removal behavior.

Exit evidence: agent uses the intended API operation, refuses unauthorized operations, and produces an evidence report from Copilot developer mode or the supported test tooling.

### Phase 5: Governance, economics, and operations

- Add an admin page for tenant connections, consent status, action counts, errors, credits, and estimated cost.
- Add per-tenant budgets, kill switch, emergency revoke, and audit export.
- Define retention/deletion behavior for prompts, extracted Office content, drafts, and audit metadata.
- Add alerts for abnormal volume, repeated permission failures, and cost spikes.

Exit evidence: security review, rollback/revoke drill, tenant deletion drill, and a cost report for a fixed test workload.

### Phase 6: Release

- Run backend typechecks and tests, add-in lint/typecheck/build, OpenAPI validation, and real-tenant E2E tests.
- Package the add-in and agent separately from the VS Code VSIX.
- Publish to a test tenant first; collect evidence before organization-wide or marketplace distribution.
- Use staged rollout, explicit admin approval, versioned manifests, and rollback instructions.

Release gate: no production publication until all Phase 0-5 exit evidence is attached to the release record and the human owner approves it.

## Non-goals for v1

- Replacing Microsoft 365 Copilot's foundation model or UI.
- Reading an entire mailbox, drive, or tenant by default.
- Autonomous email sending, file deletion, permission changes, or external sharing.
- Storing raw Office documents or access tokens in VynorAI logs.
- Supporting every Microsoft 365 host before the first workflow is measured.

## Verification matrix

| Area          | Required proof                                                    |
| ------------- | ----------------------------------------------------------------- |
| Identity      | Valid and invalid Entra tokens tested against a real tenant       |
| Authorization | Cross-tenant and missing-scope requests denied                    |
| Data safety   | No token/content leakage in logs or telemetry                     |
| Agent quality | Fixed Word/Outlook task set with deterministic checks             |
| Cost          | Credits and provider cost match the ledger                        |
| Mutations     | Insert, draft, and send boundaries require confirmation           |
| Operations    | Revoke, kill switch, rollback, and tenant deletion exercised      |
| Release       | Test-tenant install/update/uninstall and manifest validation pass |

## First implementation slice

Start with Phase 0 and Phase 1 only. Do not register broad Graph permissions or publish an agent until the workflow, tenant boundary, and permission matrix are approved. The first measurable slice is: a signed-in test user selects Word text, receives a VynorAI summary, and cannot write it back without confirmation.
