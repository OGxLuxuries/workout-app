import { createServer, request } from "node:http";

const backend = "http://127.0.0.1:8787";
const configResponse = await fetch(`${backend}/api/config`);
const config = await configResponse.json();
if (!configResponse.ok || config.devAuth || !config.smsReady) {
  throw new Error(
    "Start the built dashboard with real SMS configured before opening the gateway.",
  );
}

// Forward the dashboard only. Wrangler's local tooling must stay on loopback.
createServer((incoming, outgoing) => {
  const path = new URL(incoming.url, backend).pathname;
  if (!(
    path === "/" ||
    /^\/assets\/[\w.-]+$/.test(path) ||
    path.startsWith("/api/")
  )) {
    outgoing.writeHead(404).end();
    return;
  }
  const target = new URL(path + new URL(incoming.url, backend).search, backend);
  const upstream = request(
    target,
    {
      method: incoming.method,
      headers: { ...incoming.headers, host: target.host },
    },
    (response) => {
      outgoing.writeHead(response.statusCode, response.headers);
      response.pipe(outgoing);
    },
  );
  upstream.on("error", () =>
    outgoing.writeHead(502).end("Dashboard unavailable"),
  );
  incoming.pipe(upstream);
}).listen(8790, "127.0.0.1", () => {
  console.log("Dashboard gateway listening on http://127.0.0.1:8790");
});
