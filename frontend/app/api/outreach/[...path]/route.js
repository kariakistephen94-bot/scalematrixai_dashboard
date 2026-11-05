// Server-side proxy to the WhatsApp outreach service (outreach/). The service token stays on the server.
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
  ["GET", /^overview$/],
  ["GET", /^leads$/],
  ["GET", /^leads\.csv$/],
  ["GET", /^replies$/],
  ["GET", /^messages$/],
  ["GET", /^activity$/],
  ["GET", /^accounts\/[a-f]\/qr$/],
  ["POST", /^control$/],
  ["POST", /^collector$/],
  ["GET", /^leads\/\d+\/events$/],
  ["POST", /^leads\/\d+$/],
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
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  // This is a local, single-owner app. Do not expose this BFF without adding user authentication.
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    (origin && !isSameLocalOrigin(origin, url))
  ) {
    return Response.json(
      { error: "Use the local dashboard to access this workspace." },
      { status: 403 },
    );
  }
  if (!process.env.OUTREACH_API_TOKEN) {
    return Response.json(
      {
        error:
          "Run `npm run init` in outreach/ to link the outreach service to this dashboard.",
      },
      { status: 503 },
    );
  }
  try {
    const response = await fetch(
      `${process.env.OUTREACH_URL || "http://127.0.0.1:3200"}/api/${endpoint}${url.search}`,
      {
        method: request.method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OUTREACH_API_TOKEN}`,
        },
        body: request.method === "GET" ? undefined : await request.text(),
        signal: AbortSignal.timeout(40000),
        cache: "no-store",
      },
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      {
        error:
          "The outreach service is not running. Start it with `npm start` in outreach/, or `node scripts/dev.mjs`.",
      },
      { status: 503 },
    );
  }
}

export { proxy as GET, proxy as POST };
