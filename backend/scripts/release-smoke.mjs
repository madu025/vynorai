const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:3333").replace(
  /\/$/,
  "",
);

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...init,
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

const health = await request("/health");
if (!health.response.ok || health.body.status !== "ok") {
  throw new Error(`Health check failed (${health.response.status})`);
}

const ready = await request("/ready");
if (!ready.response.ok || ready.body.status !== "ready") {
  throw new Error(
    `Readiness check failed (${ready.response.status}): ${JSON.stringify(ready.body)}`,
  );
}

const invalidExchange = await request("/api/auth/ide-exchange", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: "invalid", state: "invalid" }),
});
if (invalidExchange.response.status !== 400) {
  throw new Error(
    `IDE exchange validation returned ${invalidExchange.response.status}, expected 400`,
  );
}
if (
  !/no-store/i.test(invalidExchange.response.headers.get("cache-control") || "")
) {
  throw new Error("IDE exchange response is missing Cache-Control: no-store");
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      baseUrl,
      billing: ready.body.billing,
      redis: ready.body.redis,
    },
    null,
    2,
  ),
);
