// Streams a demo video / thumbnail to the FastAPI backend, which stores it in Supabase Storage.
// Local, single-owner app: same guard as the main BFF.
export const maxDuration = 300;

export async function POST(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const local = ["localhost", "127.0.0.1", "[::1]"];
  let sameOrigin = !origin;
  try {
    sameOrigin = sameOrigin || new URL(origin).host === url.host;
  } catch {}
  if (!local.includes(url.hostname) || !sameOrigin) {
    return Response.json({ detail: "Use the local dashboard." }, { status: 403 });
  }
  if (!process.env.DASHBOARD_API_TOKEN) {
    return Response.json({ detail: "Dashboard token is not configured." }, { status: 503 });
  }
  const kind = url.searchParams.get("kind") === "image" ? "image" : "video";
  try {
    const response = await fetch(
      `${process.env.BACKEND_URL || "http://127.0.0.1:8001"}/projects/upload?kind=${kind}`,
      {
        method: "POST",
        headers: {
          "Content-Type": request.headers.get("content-type") || "application/octet-stream",
          "X-Dashboard-Token": process.env.DASHBOARD_API_TOKEN,
        },
        body: await request.arrayBuffer(),
        signal: AbortSignal.timeout(280000),
        cache: "no-store",
      },
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ detail: "Upload failed. Is the backend running?" }, { status: 503 });
  }
}
