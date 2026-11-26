// "Decode" text effect: rows appear one after another, and each character shows random glyphs
// (class "g") until it settles into the real one, left to right with some jitter. Spaces are settled
// from the start, so layout and ASCII art keep their shape. Used by the GitHub card and the role block.

export interface Line { text: string; dim?: boolean }
export interface DecodeOptions {
  rowGap?: number; charMs?: number; jitter?: number;
  /** Lay out every row up front (empty until its turn), so the container's height never changes mid-animation */
  reserve?: boolean;
}

const GLYPHS = "01#%@*+=/\\|[]{}$?!~^<>";

/** Decode `lines` into `out` (replacing its contents). Returns a function that stops the animation. */
export function decode(out: HTMLElement, lines: Line[], { rowGap = 150, charMs = 18, jitter = 140, reserve = false }: DecodeOptions = {}) {
  out.textContent = "";
  const rows = lines.map((l) => {
    const row = document.createElement("div");
    if (l.dim) row.className = "dim";
    return row;
  });
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    rows.forEach((r, i) => { r.textContent = lines[i].text; out.append(r); });
    return () => {};
  }
  // When each character settles
  const settle = lines.map((l, i) => [...l.text].map((_, k) => i * rowGap + 60 + k * charMs + Math.random() * jitter));
  const t0 = performance.now();
  let shown = 0;
  if (reserve) { rows.forEach((r) => out.append(r)); shown = rows.length; }
  const id = window.setInterval(() => {
    const t = performance.now() - t0;
    let done = true;
    lines.forEach((l, i) => {
      if (t < i * rowGap) { done = false; return; }
      if (i >= shown) { out.append(rows[i]); shown = i + 1; }
      const parts: Node[] = [];
      let run = "";
      [...l.text].forEach((ch, k) => {
        if (ch === " " || t >= settle[i][k]) { run += ch; return; }
        done = false;
        if (run) { parts.push(document.createTextNode(run)); run = ""; }
        const g = document.createElement("span");
        g.className = "g";
        g.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        parts.push(g);
      });
      if (run) parts.push(document.createTextNode(run));
      rows[i].replaceChildren(...parts);
    });
    if (done) clearInterval(id);
  }, 40);
  return () => clearInterval(id);
}
