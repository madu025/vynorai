window.__VYNORAI_M365_CONFIG__ = {
  tenantId: "7682180e-9bf1-46ae-9fef-27698629142a",
  authority: "organizations",
  clientId: "1fb61677-b1de-4c95-8d24-dcfc9eb6c4a6",
  redirectUri: "https://vynor.lk/m365/auth-callback.html",
  scopes: [
    "api://4ffebafc-d84a-414b-a50f-0bc8e65fc46c/m365.excel.read",
    "api://4ffebafc-d84a-414b-a50f-0bc8e65fc46c/m365.excel.write",
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
