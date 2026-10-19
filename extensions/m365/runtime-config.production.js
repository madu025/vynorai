window.__VYNORAI_M365_CONFIG__ = {
  tenantId: "6779fb31-48e1-4abe-af8f-5c5bd54c19af",
  authority: "organizations",
  clientId: "031fc03f-62ed-4baa-b82f-90892157fa4a",
  redirectUri: "https://vynor.lk/m365/auth-callback.html",
  scopes: [
    "api://9d6cdea9-2936-40cd-9228-5f36a12868b2/m365.excel.read",
    "api://9d6cdea9-2936-40cd-9228-5f36a12868b2/m365.excel.write",
  ],
  // Enable only after the Entra app registration has delegated Mail.Send consent.
  graphScopes: ["https://graph.microsoft.com/Mail.Send"],
  // Enable only after delegated Mail.ReadWrite consent is approved for large attachments/drafts.
  graphLargeScopes: [
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/Mail.ReadWrite",
  ],
  apiBaseUrl: "https://vynor.lk",
};
