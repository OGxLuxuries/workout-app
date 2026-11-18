const CACHE = "workout-shell-v2";
async function storeShell(response) {
  if (
    !response.ok ||
    !response.headers.get("Content-Type")?.includes("text/html")
  )
    return;
  const cache = await caches.open(CACHE);
  const markup = await response.clone().text();
  const assets = [
    ...new Set(
      [...markup.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  if (!assets.length) return;
  const missing = [];
  for (const asset of assets)
    if (!(await cache.match(asset))) missing.push(asset);
  if (missing.length) await cache.addAll(missing);
  await cache.put("/", response);
}
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch("/", {
        cache: "reload",
        credentials: "omit",
      });
      if (!response.ok) throw new Error("Could not download workout app.");
      await storeShell(response);
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("workout-shell-") && key !== CACHE)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (event.request.mode === "navigate") {
    const online = fetch(event.request);
    if (url.pathname === "/")
      event.waitUntil(
        online.then((response) => storeShell(response.clone())).catch(() => {}),
      );
    event.respondWith(
      online.catch(async () => {
        return (
          (await (await caches.open(CACHE)).match("/")) ?? Response.error()
        );
      }),
    );
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const previous = await cache.match(event.request);
        if (previous) return previous;
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      })(),
    );
  }
});
self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("Workout Competition", {
      body: event.data?.text() || "You have new inbox activity.",
      icon: "/app-192.png",
      data: "/?inbox=1",
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/?inbox=1"));
});
