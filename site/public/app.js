/* scroll reveal */
const items = document.querySelectorAll(".reveal");
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );
  items.forEach((el) => io.observe(el));
} else {
  items.forEach((el) => el.classList.add("in"));
}

/* pitch form */
const form = document.getElementById("pitch-form");
const msg = document.getElementById("form-msg");

function say(text, kind) {
  msg.textContent = text;
  msg.className = "form-msg" + (kind ? " " + kind : "");
}

form?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = form.querySelector("button[type=submit]");
  const data = Object.fromEntries(new FormData(form).entries());

  for (const el of form.querySelectorAll("[aria-invalid]")) el.removeAttribute("aria-invalid");

  const bad = (field, text) => {
    const el = form.querySelector(`[name="${field}"]`);
    el?.setAttribute("aria-invalid", "true");
    el?.focus();
    say(text, "err");
  };

  if (!data.name?.trim()) return bad("name", "Your name, please.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email?.trim() || "")) return bad("email", "That email doesn't look right.");
  if ((data.note?.trim() || "").length < 20) return bad("note", "A couple of sentences on what you're building.");

  btn.disabled = true;
  say("Sending…");

  try {
    const res = await fetch("/api/pitch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "Something went wrong. Try email instead.");
    form.reset();
    say("Got it — thanks. I'll come back to you either way.", "ok");
  } catch (err) {
    say(err.message, "err");
  } finally {
    btn.disabled = false;
  }
});
