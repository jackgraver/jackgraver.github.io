// Role panel beside "Engineer at DataVisor": clicking "since 2025" opens it and its lines decode in
// (see decode.ts). Clicking the button again, clicking elsewhere or pressing Escape closes it. The copy
// lives in index.astro (data-lines on #role) so it can be edited there.
import { decode, type Line } from "./decode";

const toggle = document.getElementById("role-toggle");
const role = document.getElementById("role");
const out = document.getElementById("role-out");

if (toggle && role && out) {
  const lines: Line[] = JSON.parse(role.dataset.lines || "[]");
  let stop = () => {};
  const isOpen = () => toggle.getAttribute("aria-expanded") === "true";

  function set(open: boolean) {
    stop();
    toggle!.setAttribute("aria-expanded", String(open));
    role!.classList.toggle("open", open);
    // reserve: all rows are laid out up front so the panel keeps its size while the text decodes
    if (open) stop = decode(out!, lines, { rowGap: 90, charMs: 12, jitter: 100, reserve: true });
  }

  toggle.addEventListener("click", () => set(!isOpen()));
  document.addEventListener("click", (e) => {
    if (isOpen() && !role.contains(e.target as Node) && !toggle.contains(e.target as Node)) set(false);
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) set(false);
  });
  // Leaving the landing panel (inert) closes it
  const home = document.getElementById("home");
  if (home) {
    new MutationObserver(() => home.inert && isOpen() && set(false))
      .observe(home, { attributes: true, attributeFilter: ["inert"] });
  }
}
