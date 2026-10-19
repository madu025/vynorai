# Overnight verification report, 2026-10-19

Scope: everything that can be verified without Excel on the web and without Graph email. Nothing was pushed, deployed or published.

## Results

| Check                                                                 | Result                                        |
| --------------------------------------------------------------------- | --------------------------------------------- |
| `tsc --noEmit` backend, core, gui, extensions/vscode, extensions/m365 | 5 / 5 clean                                   |
| extensions/m365 unit tests (`npx tsx --test src/*.test.ts`)           | 333 pass, 0 fail                              |
| extensions/m365 offline batch (`test/batch/run.ts --all`)             | 90 cases: 84 pass, 0 fail, 6 skip (live only) |
| extensions/m365 variation sweep (`test/batch/fuzz.ts`)                | 312 variations, 0 differ                      |
| backend tests                                                         | 355: 354 pass, 0 fail, 1 skipped              |
| core tests (vitest)                                                   | 2044 pass, 0 fail, 20 skipped                 |
| gui tests (vitest)                                                    | 736 pass, 0 fail                              |
| `scripts/check-doc-links.mjs`                                         | 391 paths, all exist                          |

## Built or fixed

1. Office Script and VBA generation from one sentence (`macroGen.ts`): sort, Total column, freeze header, autofit, remove duplicates, filter buttons, header style. Fails closed. The add-in only shows the code; it never runs it. The batch showed the first Total column added a date column; dates, identifiers and rates are now excluded.
2. Dropped-request check (`workflowCheck.ts`): a sentence that names a job the plan does not cover (split, unpivot, lookup, quality, formatting, summary, PivotTable, chart) now says so in the pane instead of silently ignoring it. One Undo covering every action of a multi-step plan is covered by a test.
3. Clean result keeps text identifiers as text (`textGuard.ts`): leading-zero IDs, text dates and similar strings get Excel's text prefix when the cleaned copy is written, and the source number formats are copied. Apply-level tests use the fake workbook. Live check pending.
4. Politeness and trailing punctuation ("could you add X, thanks.") no longer break a request (`normalizeInstruction`). The variation sweep found 8 failures before the fix and 0 after.
5. core test suite repaired on Windows (CRLF fixtures, POSIX shell lookup, `file://` paths, one stale swarm assertion): 70 failures to 0. Test files only.
6. Production cutover to the new Vynor Entra tenant (earlier work): apps, redirect URIs, add-in config and backend `.env` verified; publisher domain is `vynor.lk` on both apps.

## Not verified, and why

- Excel on the web, live: the browser tool has no permission for `excel.cloud.microsoft`. Pending live: the 6 skipped batch cases (520k question, explain, undo, new chat, session, AI), the clean-result text prefix and number-format copy, the Script/VBA panel (copy button), the dropped-request notice.
- Graph email: on hold. `setVerifiedPublisher` fails with "MPN ID 7178898 does not exist or you do not have access" until the Partner Center account is verified (identity and business verification). Partner Center shows `Prasad@Vynorlk.onmicrosoft.com` with Global admin and Account admin, so access is not the cause. The Outlook web draft fallback remains in place.
- Excel sign-in and consent with the new Entra apps (`prasad@slts.lk`) has not been re-tested.

## Local commits (not pushed)

`d4976ec`, `f2b2ff6`, `fd1bac1`, `e5f959c`, `9274ff4`, `3e06efe`, plus this report. Build id in `taskpane.html` is 20261019.17; it has not been published.

## For the morning

1. Finish Partner Center verification, then rerun `setVerifiedPublisher` for both apps.
2. Allow the browser tool on `excel.cloud.microsoft` to run the live items above.
3. Review the local commits, then decide on `git push` and the extension and backend release.
