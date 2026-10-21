// Kitten sitting sign-up: serves the single static page.
const PORT = Number(process.env.KITTEN_PORT || 3333);
const PAGE = new URL("./index.html", import.meta.url).pathname;

Bun.serve({
  port: PORT,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname !== "/" && pathname !== "/index.html") return new Response("Not found", { status: 404 });
    return new Response(Bun.file(PAGE), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
});

console.log(`kitten sign-up on http://localhost:${PORT}`);
