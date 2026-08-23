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
    if (!has("email") && !has("phone")) {
      e.preventDefault();
      return fail("Leave an email or a phone number so I can actually send you the invite.");
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
  box.textContent = err === "slow"
    ? "That's a lot of signups from one place — try again in a bit."
    : "Please add your name, an email or phone, and at least one category.";
  box.hidden = false;
})();
