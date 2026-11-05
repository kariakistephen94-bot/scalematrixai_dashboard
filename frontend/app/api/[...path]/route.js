function isSameLocalOrigin(origin, target) {
  try {
    const source = new URL(origin);
    const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
    return (
      local.has(source.hostname) &&
      local.has(target.hostname) &&
      source.protocol === target.protocol &&
      source.port === target.port
    );
  } catch {
    return false;
  }
}

const allowed = [
  ["GET", /^projects$/],
  ["POST", /^projects$/],
  ["PUT", /^projects\/[a-f0-9-]{36}$/],
  ["DELETE", /^projects\/[a-f0-9-]{36}$/],
  ["GET", /^emails$/],
  ["GET", /^social$/],
  ["GET", /^social\/leads$/],
  ["POST", /^social\/search$/],
  ["POST", /^social\/runs\/[a-f0-9-]{36}\/stop$/],
  ["GET", /^crm\/[a-f0-9-]{36}\/message$/],
  ["POST", /^crm\/[a-f0-9-]{36}\/message$/],
  ["GET", /^agent$/],
  ["PUT", /^agent\/settings$/],
  ["POST", /^agent\/run$/],
  ["POST", /^agent\/messages$/],
  ["POST", /^crm\/[a-f0-9-]{36}\/research-owner$/],
  ["POST", /^crm\/businesses$/],
  ["POST", /^crm\/import$/],
  ["GET", /^crm$/],
  ["POST", /^crm$/],
  ["PUT", /^crm\/[a-f0-9-]{36}$/],
  ["POST", /^search\/quick$/],
  ["GET", /^dashboard$/],
  ["GET", /^maps\/leads$/],
  ["PATCH", /^maps\/leads\/[a-f0-9-]{36}$/],
  ["PUT", /^settings$/],
  ["POST", /^generate\/(daily|content|prospects)$/],
  ["PATCH", /^posts\/[a-f0-9-]{36}$/],
  ["PATCH", /^prospects\/[a-f0-9-]{36}$/],
];

async function proxy(request, context) {
  const { path } = await context.params;
  const endpoint = path.join("/");
  if (
    !allowed.some(
      ([method, expression]) =>
        method === request.method && expression.test(endpoint),
    )
  ) {
    return Response.json({ detail: "Not found." }, { status: 404 });
  }
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  // This is a local, single-owner app. Do not expose this BFF without adding user authentication.
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    (origin && !isSameLocalOrigin(origin, url))
  ) {
    return Response.json(
      { detail: "Use the local dashboard to access this workspace." },
      { status: 403 },
    );
  }
  if (!process.env.DASHBOARD_API_TOKEN) {
    return Response.json(
      { detail: "Run scripts/setup_env.py to configure the local dashboard." },
      { status: 503 },
    );
  }
  try {
    const response = await fetch(
      `${process.env.BACKEND_URL || "http://127.0.0.1:8001"}/${endpoint}${url.search}`,
      {
        method: request.method,
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Token": process.env.DASHBOARD_API_TOKEN,
        },
        body: request.method === "GET" ? undefined : await request.text(),
        signal: AbortSignal.timeout(40000),
        cache: "no-store",
      },
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { detail: "FastAPI is not reachable. Start the backend on port 8001." },
      { status: 503 },
    );
  }
}

export {
  proxy as GET,
  proxy as PUT,
  proxy as POST,
  proxy as PATCH,
  proxy as DELETE,
};
