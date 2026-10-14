export interface M365ApiClient {
  planExcel(input: unknown): Promise<any>;
  approveExcel(input: {
    planId: string;
    sourceFingerprint: string;
    approvalToken: string;
  }): Promise<any>;
}

export class M365ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "M365ApiError";
  }
}

export function createM365ApiClient(
  baseUrl: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): M365ApiClient {
  if (!accessToken) throw new Error("M365 OAuth access token is required");
  const request = async (path: string, body: unknown) => {
    const response = await fetcher(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-correlation-id": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
      const code = payload?.error?.code || "M365_API_REQUEST_FAILED";
      throw new M365ApiError(code, response.status);
    }
    return payload;
  };
  return {
    planExcel: (input) => request("/v1/m365/excel/plan", input),
    approveExcel: (input) =>
      request("/v1/m365/excel/apply", { ...input, confirmed: true }),
  };
}
