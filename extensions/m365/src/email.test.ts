import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGraphMail,
  buildGraphExcelMail,
  sendGraphMailAdaptive,
  sendExcelWorkbookEmail,
  validateExcelEmailRequest,
} from "./email.js";

const request = {
  to: "prasad@slts.lk",
  subject: "Approved Excel report",
  body: "Please find the approved workbook attached.",
  attachmentName: "VynorAI-Excel-Report.xlsx",
  attachmentBase64: "UEsDBA==",
  attachmentBytes: 4,
};

test("Excel email validation rejects header injection and unsafe attachment names", () => {
  assert.throws(
    () =>
      validateExcelEmailRequest({
        ...request,
        to: "a@example.com\r\nBcc:x@example.com",
      }),
    /EMAIL_RECIPIENT_INVALID/,
  );
  assert.throws(
    () =>
      validateExcelEmailRequest({ ...request, attachmentName: "report.csv" }),
    /EMAIL_ATTACHMENT_NAME_INVALID/,
  );
});

test("Graph mail payload contains the XLSX attachment and no workbook values outside the attachment", () => {
  const payload: any = buildGraphExcelMail(request);
  assert.equal(payload.saveToSentItems, true);
  assert.deepEqual(payload.message.toRecipients, [
    { emailAddress: { address: "prasad@slts.lk" } },
  ]);
  assert.equal(
    payload.message.attachments[0].contentType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(payload.message.attachments[0].contentBytes, "UEsDBA==");
});

test("HTML mail supports verified inline chart attachments", () => {
  const payload: any = buildGraphMail({
    to: ["prasad@slts.lk"],
    subject: "Dashboard",
    body: '<p>Results</p><img src="cid:vynorai-1@chart">',
    bodyType: "HTML",
    attachments: [
      {
        name: "Sales.jpg",
        contentType: "image/jpeg",
        contentBytes: "AQID",
        bytes: 3,
        isInline: true,
        contentId: "vynorai-1@chart",
      },
    ],
  });
  assert.equal(payload.message.body.contentType, "HTML");
  assert.equal(payload.message.attachments[0].isInline, true);
  assert.equal(payload.message.attachments[0].contentId, "vynorai-1@chart");
});

test("large report delivery uses a resumable Outlook draft upload session", async () => {
  const large = Buffer.alloc(3_000_000).toString("base64");
  const calls: string[] = [];
  const delivery = await sendGraphMailAdaptive(
    "graph-token",
    {
      to: ["prasad@slts.lk"],
      subject: "Large report",
      body: "Report",
      attachments: [
        {
          name: "report.pdf",
          contentType: "application/pdf",
          contentBytes: large,
          bytes: 3_000_000,
        },
      ],
    },
    async (url, init) => {
      calls.push(`${init?.method} ${String(url)}`);
      if (String(url).endsWith("/messages"))
        return new Response(JSON.stringify({ id: "draft-1" }), { status: 201 });
      if (String(url).includes("createUploadSession"))
        return new Response(
          JSON.stringify({ uploadUrl: "https://upload.example/session" }),
          { status: 201 },
        );
      if (String(url) === "https://upload.example/session")
        return new Response(null, { status: 201 });
      if (String(url).endsWith("/draft-1/send"))
        return new Response(null, { status: 202 });
      return new Response(null, { status: 404 });
    },
  );
  assert.equal(delivery, "upload-session");
  assert.equal(
    calls.some((call) => call.includes("createUploadSession")),
    true,
  );
  assert.equal(
    calls.some((call) => call.endsWith("/draft-1/send")),
    true,
  );
});

test("sending an Excel email uses Microsoft Graph and reports permission failures", async () => {
  let called = false;
  await sendExcelWorkbookEmail("graph-token", request, async (url, init) => {
    called = true;
    assert.equal(url, "https://graph.microsoft.com/v1.0/me/sendMail");
    assert.equal(init?.method, "POST");
    assert.equal(
      (init?.headers as Record<string, string>).authorization,
      "Bearer graph-token",
    );
    return new Response(null, { status: 202 });
  });
  assert.equal(called, true);

  await assert.rejects(
    () =>
      sendExcelWorkbookEmail(
        "graph-token",
        request,
        async () => new Response(null, { status: 403 }),
      ),
    /EMAIL_PERMISSION_DENIED/,
  );
});

test("outlookWebDraftUrl fills a compose link and keeps it short", async () => {
  const { outlookWebDraftUrl } = await import("./email.js");
  const small = outlookWebDraftUrl({
    to: ["prasad@slts.lk"],
    subject: "Report & test",
    body: "Line 1\nLine 2",
  });
  assert.equal(small.bodyTruncated, false);
  assert.equal(
    small.url,
    "https://outlook.office.com/mail/deeplink/compose?to=prasad%40slts.lk&subject=Report%20%26%20test&body=Line%201%0ALine%202",
  );
  const big = outlookWebDraftUrl({
    to: ["a@b.co"],
    cc: ["c@d.co"],
    subject: "S",
    body: "x".repeat(20000),
  });
  assert.equal(big.bodyTruncated, true);
  assert.ok(big.url.length <= 6000);
  assert.match(big.url, /cc=c%40d\.co/);
});

test("isGraphConsentFailure recognises admin-approval and denied consent only", async () => {
  const { isGraphConsentFailure } = await import("./email.js");
  assert.equal(
    isGraphConsentFailure(
      new Error("OAuth authorization failed: access_denied"),
    ),
    true,
  );
  assert.equal(
    isGraphConsentFailure(new Error("EMAIL_PERMISSION_DENIED")),
    true,
  );
  assert.equal(
    isGraphConsentFailure(new Error("AADSTS90094: admin consent required")),
    true,
  );
  assert.equal(isGraphConsentFailure(new Error("PDF_SLICE_INVALID")), false);
  assert.equal(
    isGraphConsentFailure(new Error("EMAIL_RECIPIENT_INVALID")),
    false,
  );
});
