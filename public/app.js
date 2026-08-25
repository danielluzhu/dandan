// Archive category filter
(() => {
  const chips = document.querySelectorAll(".chip");
  const rows = document.querySelectorAll(".past");
  const empty = document.querySelector(".pastlist__empty");
  if (!chips.length) return;

  chips.forEach((chip) => chip.addEventListener("click", () => {
    chips.forEach((c) => c.classList.toggle("is-active", c === chip));
    const want = chip.dataset.filter;
    let shown = 0;
    rows.forEach((row) => {
      const match = want === "all" || row.dataset.category === want;
      row.hidden = !match;
      if (match) shown++;
    });
    if (empty) empty.hidden = shown > 0;
  }));
})();

// Client-side guard so people get a message instead of a silent redirect
(() => {
  const form = document.querySelector(".form");
  if (!form) return;
  const err = form.querySelector(".form__error");

  const fail = (msg) => {
    err.textContent = msg;
    err.hidden = false;
    err.scrollIntoView({ block: "center", behavior: "smooth" });
    return false;
  };

  form.addEventListener("submit", (e) => {
    err.hidden = true;
    const has = (n) => form.querySelector(`[name="${n}"]`).value.trim();
    if (!has("instagram") || !has("phone")) {
      e.preventDefault();
      return fail("Both your Instagram and a phone number, please — that is how the invite reaches you.");
    }
    if (!form.querySelectorAll('[name="categories"]:checked').length) {
      e.preventDefault();
      return fail("Pick at least one thing you'd come to.");
    }
  });
})();

// Surface server-side redirect errors
(() => {
  const err = new URLSearchParams(location.search).get("error");
  const box = document.querySelector(".form__error");
  if (!err || !box) return;
  box.textContent = {
    slow: "That's a lot of signups from one place — try again in a bit.",
    instagram: "That doesn't look like an Instagram handle. Try @yourhandle.",
  }[err] || "Please add your name, Instagram, phone, and at least one category.";
  box.hidden = false;
})();

// Filter and sort the contact list
(() => {
  const list = document.querySelector(".contacts");
  if (!list) return;

  const rows = [...list.querySelectorAll(".contact")];
  const chips = [...document.querySelectorAll(".tally .tag")];
  const q = document.querySelector("#q");
  const missing = document.querySelector("#missing");
  const sort = document.querySelector("#sort");
  const empty = document.querySelector(".contacts__empty");
  const count = document.querySelector(".toolbar__count");

  let category = "all";

  const comparators = {
    name: (a, b) => a.dataset.name.localeCompare(b.dataset.name),
    added: (a, b) => a.dataset.added.localeCompare(b.dataset.added),
    interests: (a, b) =>
      Number(a.dataset.interests) - Number(b.dataset.interests) ||
      a.dataset.name.localeCompare(b.dataset.name),
  };

  function apply() {
    const term = (q?.value || "").trim().toLowerCase();
    const want = missing?.value || "";

    let shown = 0;
    for (const row of rows) {
      const d = row.dataset;
      const keep =
        (category === "all" || d.categories.split(",").includes(category)) &&
        (!term || d.search.includes(term)) &&
        (want === "" ||
          (want === "instagram" && d.hasInstagram === "0") ||
          (want === "phone" && d.hasPhone === "0") ||
          (want === "any" && d.hasInstagram === "0" && d.hasPhone === "0"));

      row.hidden = !keep;
      // Collapse anything being hidden, so an edit form never stays open off-screen.
      if (!keep) row.querySelector("details")?.removeAttribute("open");
      if (keep) shown++;
    }

    const key = sort?.value || "name";
    const desc = key.startsWith("-");
    const cmp = comparators[desc ? key.slice(1) : key];
    if (cmp) {
      const ordered = [...rows].sort((a, b) => (desc ? -cmp(a, b) : cmp(a, b)));
      // Re-appending in order is enough; hidden rows keep their place but stay hidden.
      for (const row of ordered) list.append(row);
    }

    if (empty) empty.hidden = shown > 0;
    if (count) {
      count.textContent =
        shown === rows.length
          ? `${rows.length} ${rows.length === 1 ? "person" : "people"}`
          : `${shown} of ${rows.length}`;
    }
  }

  chips.forEach((chip) => chip.addEventListener("click", () => {
    category = chip.dataset.filter;
    chips.forEach((c) => {
      const on = c === chip;
      c.classList.toggle("is-active", on);
      c.setAttribute("aria-pressed", String(on));
    });
    apply();
  }));

  q?.addEventListener("input", apply);
  missing?.addEventListener("change", apply);
  sort?.addEventListener("change", apply);
  apply();
})();

/* ---------- invite mode ---------- */
(() => {
  const table = document.querySelector(".invite__tbl");
  if (!table) return;

  const msg = document.getElementById("msg");
  const count = document.getElementById("n");
  const all = document.getElementById("all");
  const picks = () => [...document.querySelectorAll(".pick")];
  const chosen = () => picks().filter((p) => p.checked);

  const handles = () =>
    chosen().map((p) => p.dataset.handle).filter(Boolean).join(", ");
  const numbers = () =>
    chosen().map((p) => p.dataset.phone).filter(Boolean);

  function refresh() {
    if (count) count.textContent = String(chosen().length);
    const sms = document.getElementById("sms-all");
    if (sms) {
      const nums = numbers();
      // iOS wants &body=, Android wants ?body=; the comma-joined list is what both read.
      sms.href = nums.length ? `sms:${nums.join(",")}&body=${encodeURIComponent(msg?.value || "")}` : "#";
      sms.classList.toggle("is-off", nums.length === 0);
      sms.title = nums.length ? `${nums.length} with a number` : "Nobody selected has a phone number";
    }
  }

  /** Clipboard needs a user gesture and a secure context; say so rather than failing silently. */
  async function copy(text, button) {
    if (!text) {
      // Silently copying nothing looks like the button is broken.
      const was = button.textContent;
      button.textContent = "Nothing to copy";
      setTimeout(() => { button.textContent = was; }, 1600);
      return;
    }
    const said = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Press ⌘C";
      // Fall back to a selection the person can copy themselves.
      const box = document.createElement("textarea");
      box.value = text;
      document.body.append(box);
      box.select();
      setTimeout(() => box.remove(), 8000);
    }
    setTimeout(() => { button.textContent = said; }, 1600);
  }

  document.getElementById("copy-msg")?.addEventListener("click", (e) => copy(msg?.value || "", e.target));
  document.getElementById("copy-handles")?.addEventListener("click", (e) => copy(handles(), e.target));
  document.getElementById("copy-both")?.addEventListener("click", (e) =>
    copy([handles(), msg?.value || ""].filter(Boolean).join("\n\n"), e.target));

  all?.addEventListener("change", () => {
    // The header checkbox governs its own table only, not the "everyone else" one.
    table.querySelectorAll(".pick").forEach((p) => { p.checked = all.checked; });
    refresh();
  });

  document.addEventListener("change", (e) => { if (e.target.classList?.contains("pick")) refresh(); });
  msg?.addEventListener("input", refresh);
  refresh();
})();
