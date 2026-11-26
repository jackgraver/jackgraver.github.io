// Hover cards: the project preview (ProjectPreview.astro) and the GitHub activity card (GithubCard.astro).
//
// Mouse: a card follows the pointer while it's over its trigger. Moving right (toward a card that sits
// on the right) freezes it so the pointer can catch up; once the pointer is on the card it stays put,
// and it only hides after the pointer has left both the card and the trigger. A trigger's hit area
// grows while its card is open (CSS: .hot).
// Touch: no hover, so the first tap on a trigger opens the card next to it (scaled to fit); a second
// tap on the link or the card follows it, and tapping anywhere else closes it.

import { decode, type Line } from "./decode";

const isTouch = () => matchMedia("(hover: none)").matches;

const GRACE_LEAVE = 250; // ms the card survives after the pointer leaves its trigger (time to cross the gap)
const GRACE_CARD = 150; // ms after leaving the card itself
const HOLD = 700; // ms a card stays still after the pointer last moved right toward it

/** A card that eases toward the pointer, kept inside the viewport. */
function follower(el: HTMLElement) {
  let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
  let lastX = 0, flipped = false, locked = false, timer = 0, holdUntil = 0;
  let trigger: HTMLElement | null = null;

  const tick = () => {
    x += (tx - x) * 0.18;
    y += (ty - y) * 0.18;
    el.style.transform = `translate(${x}px, ${y}px)`;
    raf = el.classList.contains("on") || Math.abs(tx - x) > 0.5 ? requestAnimationFrame(tick) : 0;
  };
  // Right of the pointer, or left of it when there's no room (so the card never lands under it).
  const target = (e: MouseEvent) => {
    const w = el.offsetWidth;
    let X = e.clientX + 28;
    flipped = false;
    if (X > innerWidth - w - 12 && e.clientX - 28 - w >= 12) { X = e.clientX - 28 - w; flipped = true; }
    tx = Math.max(12, Math.min(X, innerWidth - w - 12));
    ty = Math.max(12, Math.min(e.clientY - 80, innerHeight - el.offsetHeight - 12));
  };
  const hide = () => {
    clearTimeout(timer);
    locked = false;
    el.classList.remove("on");
    trigger?.classList.remove("hot");
    trigger = null;
  };
  const later = (ms: number) => { clearTimeout(timer); timer = window.setTimeout(hide, ms); };

  el.addEventListener("mouseenter", () => { if (isTouch()) return; clearTimeout(timer); locked = true; });
  el.addEventListener("mouseleave", () => { if (isTouch()) return; locked = false; later(GRACE_CARD); });

  const api = {
    move(e: MouseEvent) {
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      if (locked) return;
      if (!flipped && el.classList.contains("on")) {
        // Heading for the card: any rightward step holds it still for HOLD ms, and the hold survives the
        // small vertical/zero-dx wobble of a slow hand. Moving left (or out of the card's rows) ends it.
        const now = performance.now();
        if (dx > 0) holdUntil = now + HOLD;
        else if (dx < -2) holdUntil = 0;
        if (now < holdUntil && e.clientY > ty - 40 && e.clientY < ty + el.offsetHeight + 40) return;
      }
      target(e);
      if (!raf) raf = requestAnimationFrame(tick);
    },
    show(e: MouseEvent, from: HTMLElement) {
      clearTimeout(timer);
      if (locked) return;
      if (trigger !== from) { trigger?.classList.remove("hot"); trigger = from; }
      from.classList.add("hot");
      if (!el.classList.contains("on")) { target(e); x = tx; y = ty; }
      lastX = e.clientX;
      api.move(e);
      el.classList.add("on");
    },
    leave() { later(GRACE_LEAVE); },
  };
  return api;
}

/** Wire a trigger element to a follower card (mouse only). */
function bindTrigger(trigger: HTMLElement, card: ReturnType<typeof follower>, onShow?: () => void) {
  trigger.addEventListener("mouseenter", (e) => { if (isTouch()) return; onShow?.(); card.show(e, trigger); });
  trigger.addEventListener("mousemove", (e) => { if (!isTouch()) card.move(e); });
  trigger.addEventListener("mouseleave", () => { if (!isTouch()) card.leave(); });
}

// --- Project preview ----------------------------------------------------------------------------
const pv = document.getElementById("preview")!;
const shot = document.getElementById("shot")!;
const pvName = document.getElementById("pv-name")!;
const pvStack = document.getElementById("pv-stack")!;
const projectCard = follower(pv);

// Preload preview images so the card is instant on first hover
document.querySelectorAll<HTMLElement>("[data-image]").forEach((el) => {
  if (el.dataset.image) new Image().src = el.dataset.image;
});

function fillProject(row: HTMLAnchorElement) {
  const d = row.dataset;
  pv.setAttribute("href", row.href);
  pvName.textContent = d.name!;
  pvStack.textContent = d.stack ?? "";
  if (d.image) {
    shot.className = "shot";
    shot.style.backgroundImage = `url(${d.image})`;
    shot.textContent = "";
  } else {
    shot.className = "shot ph";
    shot.style.backgroundImage = "";
    shot.textContent = d.name!;
  }
}
document.querySelectorAll<HTMLAnchorElement>("[data-name]").forEach((row) =>
  bindTrigger(row, projectCard, () => fillProject(row)),
);

// --- GitHub card --------------------------------------------------------------------------------
// Hovering a day reads it out in the caption, and clicking a day
// opens that day on GitHub (streaks and the profile are plain links).
const ghEl = document.getElementById("gh-card");
let readCell = (_c: HTMLElement) => {};
let resetGh = () => {};
let readLang = (_el: HTMLElement) => {};
if (ghEl) {
  const ghLink = document.querySelector<HTMLElement>("[data-gh]");
  if (ghLink) bindTrigger(ghLink, follower(ghEl));

  const heat = ghEl.querySelector<HTMLElement>(".heat")!;
  const read = ghEl.querySelector<HTMLElement>("#gh-read")!;
  const closest = (e: Event) => (e.target as Element).closest<HTMLElement>("[data-d]");

  // Below the heatmap: the language breakdown, or (while a day is hovered) the projects worked on that day.
  // Rows stream in one after another and "decode": random glyphs settle left to right into the real text.
  // The data only has public repos; other days get a dim note.
  const detail = ghEl.querySelector<HTMLElement>("#gh-detail")!;
  const dayEl = ghEl.querySelector<HTMLElement>("#gh-day")!;
  const langOut = ghEl.querySelector<HTMLElement>("#gh-lang-detail")!;
  const langsEl = ghEl.querySelector<HTMLElement>(".langs")!;
  const byLang: Record<string, [string, number][]> = JSON.parse(document.getElementById("gh-langs")?.textContent || "{}");
  const byDay: Record<string, [string, number][]> = JSON.parse(document.getElementById("gh-days")?.textContent || "{}");
  let stopDecode = () => {}, pending = 0;
  const stopTyping = () => { stopDecode(); clearTimeout(pending); };
  function decodeLines(out: HTMLElement, lines: Line[]) {
    stopTyping();
    dayEl.textContent = "";
    langOut.textContent = "";
    stopDecode = decode(out, lines);
  }
  function showDay(c: HTMLElement) {
    const d = c.dataset.d!, n = Number(c.dataset.n);
    const repos = byDay[d];
    const fmt = ([name, commits]: [string, number]) => ({ text: `${name} · ${commits} commit${commits === 1 ? "" : "s"}` });
    detail.dataset.mode = "day";
    decodeLines(
      dayEl,
      repos?.length
        ? repos.length > 4 ? [...repos.slice(0, 3).map(fmt), { text: `+ ${repos.length - 3} more projects`, dim: true }] : repos.map(fmt)
      : n === 0 ? [{ text: "rest day.", dim: true }]
      : [{ text: "private work, nothing public to show.", dim: true }],
    );
  }
  // Hovering a language (bar segment or legend entry) dims the rest and decodes the projects that use it.
  function clearLang() {
    stopTyping();
    langOut.textContent = "";
    langsEl.classList.remove("pick");
    langsEl.querySelectorAll(".on").forEach((e) => e.classList.remove("on"));
  }
  function showLang(el: HTMLElement) {
    const name = el.dataset.lang!;
    const repos = byLang[name] ?? [];
    langsEl.classList.add("pick");
    langsEl.querySelectorAll<HTMLElement>("[data-lang]").forEach((e) => e.classList.toggle("on", e.dataset.lang === name));
    const fmt = ([repo, share]: [string, number]) => ({ text: `${repo} · ${Math.round(share)}%` });
    decodeLines(
      langOut,
      repos.length > 4 ? [...repos.slice(0, 3).map(fmt), { text: `+ ${repos.length - 3} more projects`, dim: true }] : repos.map(fmt),
    );
  }
  langsEl.addEventListener("mouseover", (e) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-lang]");
    if (!el || isTouch()) return;
    stopTyping();
    pending = window.setTimeout(() => showLang(el), 60);
  });
  langsEl.addEventListener("mouseleave", () => { if (!isTouch()) clearLang(); });
  readLang = showLang;
  resetGh = () => { clearLang(); detail.dataset.mode = "langs"; read.textContent = read.dataset.default!; };

  readCell = (c) => { read.textContent = c.dataset.t!; showDay(c); }; // touch: immediate
  heat.addEventListener("mouseover", (e) => {
    const c = closest(e);
    if (!c || isTouch()) return;
    read.textContent = c.dataset.t!;
    stopTyping();
    pending = window.setTimeout(() => showDay(c), 70); // wait for the pointer to settle on a day
  });
  heat.addEventListener("mouseleave", () => { if (!isTouch()) resetGh(); });
  heat.addEventListener("click", (e) => {
    const c = closest(e);
    if (c && !isTouch()) location.assign(`https://github.com/JackGraver?tab=overview&from=${c.dataset.d}&to=${c.dataset.d}`);
  });
}

// --- Touch: tap to open, tap again to follow ----------------------------------------------------
let armed: { link: HTMLAnchorElement; el: HTMLElement } | null = null;
function disarm() {
  if (!armed) return;
  armed.el.classList.remove("on", "armed");
  armed = null;
}
function arm(link: HTMLAnchorElement) {
  const isGh = link.hasAttribute("data-gh");
  const el = isGh ? ghEl : pv;
  if (!el) return false;
  if (!isGh) fillProject(link);
  else resetGh();
  const scale = Math.min(1, (innerWidth - 24) / el.offsetWidth);
  const w = el.offsetWidth * scale;
  const h = el.offsetHeight * scale;
  const r = link.getBoundingClientRect();
  const x = Math.max(12, Math.min((innerWidth - w) / 2, innerWidth - w - 12));
  const below = r.bottom + 12;
  const y = below + h <= innerHeight - 12 ? below : Math.max(12, r.top - h - 12);
  el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  el.classList.add("armed", "on");
  armed = { link, el };
  return true;
}
document.addEventListener(
  "click",
  (e) => {
    if (!isTouch()) return;
    const t = e.target as Element;
    if (armed && armed.el.contains(t)) {
      if (armed.el === ghEl) {
        const cell = t.closest<HTMLElement>("[data-d]");
        if (cell) { e.preventDefault(); readCell(cell); return; } // tap a day: read it out
        const lang = t.closest<HTMLElement>("[data-lang]");
        if (lang) { e.preventDefault(); readLang(lang); return; } // tap a language: list its projects
        if (t.closest("a")) { disarm(); return; } // a stat link: follow it
      }
      e.preventDefault();
      const href = armed.link.href;
      disarm();
      location.assign(href);
      return;
    }
    const link = t.closest<HTMLAnchorElement>("[data-name], [data-gh]");
    if (link && armed?.link === link) {
      disarm(); // second tap: let the link navigate
      return;
    }
    disarm();
    if (link && arm(link)) e.preventDefault();
  },
  true,
);
document.getElementById("projects-panel")?.addEventListener("scroll", disarm, { passive: true });
const track = document.getElementById("track");
track?.addEventListener("transitionstart", (e) => e.target === track && disarm());
