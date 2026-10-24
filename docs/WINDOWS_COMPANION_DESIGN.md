# Windows companion design

Status: **not built.** This repository contains only the contract
([packages/m365-contracts/src/companion.ts](../packages/m365-contracts/src/companion.ts)) and the pure routing
logic ([extensions/m365/src/companionState.ts](../extensions/m365/src/companionState.ts)). There is no VSTO, COM,
VBA or Solver code, no installer and no local service. In this repository the transport always reports
`not_installed`, so no companion feature is ever offered.

## Why a companion

Office.js does not expose VBA/COM, Solver, Scenario Manager, Power Pivot / Data Model authoring or
Sparklines authoring. Only Excel desktop on Windows could host them, through a separate signed program. Web and
Mac never get these features and the pane never implies parity; the closest supported alternatives (regular
PivotTable, formula report, deterministic local analytics) stay the answer there.

## States

| State                | Meaning                                                                 | Features offered                                                         |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `unsupported_host`   | Not Excel desktop on Windows (Web, Mac, mobile, unknown)                | none                                                                     |
| `not_installed`      | No answer to the local hello                                            | none                                                                     |
| `not_signed`         | Reply failed signature, publisher pin, nonce echo or the no-export rule | none                                                                     |
| `version_mismatch`   | Older than the required minimum, or unreadable version                  | none                                                                     |
| `tenant_not_allowed` | Organisation is not on the companion's allow-list                       | none                                                                     |
| `ready`              | Everything verified                                                     | only the features the companion reports, intersected with the known list |

## Local discovery and authentication

1. The pane builds a `hello` with a fresh random nonce (at least 16 bytes), the tenant id and the minimum
   version, and sends it only over a channel the Windows user session owns (a per-user named pipe with an ACL
   restricted to the current user; a TCP port is not used).
2. The companion answers `hello-ack` with the echoed nonce, its version, the thumbprint of the certificate it is
   signed with, a signature over `nonce + version + tenantId + sorted features`, and its own tenant allow-list
   result.
3. A trusted verifier (not the pane's untrusted code path) checks the signature and pins the thumbprint to the
   publisher certificate. Authentication is mutual: the companion in turn accepts only a caller whose process
   belongs to the same Windows user and whose request carries a short-lived token minted by the signed-in
   VynorAI session, so another program on the machine cannot drive it.
4. `rawWorkbookExport` is always `false` in the handshake; a reply that says otherwise is rejected.

No workbook values travel in discovery. Later operations (not defined yet) must send ranges only after the
usual preview and explicit approval, bounded and masked as for the managed sandbox.

## Packaging and signing

- Package as MSIX (per-user install, no admin rights, clean uninstall), or an equivalent signed installer.
- Sign the binary and the package with an organisation code-signing certificate (EV preferred) and timestamp it.
  The certificate thumbprint is the value the pane pins.
- Ship the pinned thumbprint list in the add-in policy, with rotation: a new certificate is added before the
  old one is removed.

## Update channel

Controlled and signed: the companion checks a VynorAI-hosted manifest over HTTPS, downloads only packages signed by
the pinned publisher, supports staged rings and a kill switch that forces `version_mismatch` for a bad release.
The pane's `minCompanionVersion` lets the server require an upgrade.

## Least privilege

- Runs as the signed-in user, not as SYSTEM or administrator; no listening network socket.
- No file access outside what Excel already opened; no host-wide mounts; no shell execution endpoint.
- Each operation is allow-listed by feature name and validated against a schema; unknown features are ignored.
- Network egress only to the VynorAI update/audit endpoints.

## Tenant allow-list and audit

- The allow-list of Entra tenant ids is set by VynorAI administrators and delivered in the signed policy; the
  companion answers `tenantAllowed` for the tenant in the hello.
- Every dispatch records user id, tenant id, feature, time, outcome and a hash of the request. It records no
  workbook values, tokens or PII, and the audit log is bounded and expires.

## Threat model

| Threat                                   | Mitigation                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Local malware impersonates the companion | publisher pin plus signature over a fresh nonce; per-user pipe ACL                        |
| Malware drives the real companion        | mutual authentication and a short-lived session token; per-operation approval in the pane |
| Replay of an old reply                   | nonce echoed inside the signature                                                         |
| Old, vulnerable companion                | `minCompanionVersion`, kill switch                                                        |
| Data exfiltration                        | no raw export by default, no network except VynorAI endpoints, masked bounded payloads    |
| Feature leak to Web/Mac                  | `companionOnlyFeatures` returns nothing unless Windows desktop and `ready` (tested)       |

## Remaining work (not done)

A signing certificate, the MSIX project, the local service, the verifier, the update service, the tenant policy
endpoint and the audit endpoint do not exist. Until they do, the companion states stay design-only and the pane
must keep saying that these Windows-only features are unavailable.
