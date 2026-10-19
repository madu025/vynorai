window.__VYNORAI_M365_CONFIG__ = {
  tenantId: "<directory-tenant-id>",
  authority: "organizations",
  clientId: "<spa-client-id>",
  redirectUri: "https://localhost:3000/taskpane.html",
  scopes: [
    "api://<api-client-id>/m365.excel.read",
    "api://<api-client-id>/m365.excel.write",
  ],
  // Requested only when the user explicitly approves sending the current workbook by email.
  graphScopes: ["https://graph.microsoft.com/Mail.Send"],
  // Optional: required only for 3 MB+ resumable draft attachments.
  graphLargeScopes: [
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/Mail.ReadWrite",
  ],
  apiBaseUrl: "https://localhost:3000",
};
