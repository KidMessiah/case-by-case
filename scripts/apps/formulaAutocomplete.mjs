/** @ref autocomplete for formula inputs. */

import { ROLL_DATA_REFS } from "../rollDataRefs.mjs";
import { isDarkTheme } from "../theme.mjs";

/** The in-progress "@..." reference immediately before the cursor, if any. */
const TOKEN_RE = /@([\w.]*)$/;
const MAX_RESULTS = 8;

/** Strict contiguous substring score (lower is better). */
function substringScore(query, text) {
  if (!query) return null;
  const idx = text.indexOf(query);
  if (idx === -1) return null;
  return idx === 0 ? 0 : 10 + idx;
}

/** Loose alias or keyword score, with subsequence fallback. */
function fuzzyScore(query, text) {
  const strict = substringScore(query, text);
  if (strict !== null) return strict;
  let ti = 0, gaps = 0;
  for (const ch of query) {
    const found = text.indexOf(ch, ti);
    if (found === -1) return null;
    gaps += found - ti;
    ti = found + 1;
  }
  return 100 + gaps;
}

/** Rank refs by token match first, alias/keyword match second. */
export function rankRefs(query) {
  const q = query.toLowerCase();
  const results = [];
  for (const ref of ROLL_DATA_REFS) {
    const tokenText = ref.token.slice(1).toLowerCase(); // Drop the leading "@" for matching.
    const tokenScore = substringScore(q, tokenText);
    if (tokenScore !== null) {
      results.push({ ref, tier: 0, sortKey: tokenScore });
      continue;
    }
    let best = null;
    for (const alias of [ref.label, ...(ref.keywords ?? [])]) {
      const s = fuzzyScore(q, alias.toLowerCase());
      if (s !== null && (best === null || s < best)) best = s;
    }
    if (best !== null) results.push({ ref, tier: 1, sortKey: best });
  }
  results.sort((a, b) => (a.tier - b.tier) || (a.sortKey - b.sortKey) || (a.ref.token.length - b.ref.token.length));
  return results.slice(0, MAX_RESULTS).map(r => r.ref);
}

/** Auto-wrap @refs before dice sizes: @profd6 -> (@prof)d6. */
export function autoParenFormula(value) {
  return value.replace(/(?<!\()(@[\w.]+)(?=d\d)/g, "($1)");
}

/**
 * Attach @ref autocomplete to a formula input.
 * Safe to call once per element; rerenders get fresh listeners on the new DOM node.
 * @param {HTMLInputElement} input
 */
export function attachFormulaAutocomplete(input) {
  if (!input || input.dataset.cbAutocompleteBound) return;
  input.dataset.cbAutocompleteBound = "1";

  let list = null;
  let activeIndex = -1;
  let currentRefs = [];

  const position = () => {
    if (!list) return;
    const r = input.getBoundingClientRect();
    // Keep the panel wide enough without overflowing the viewport.
    const width = Math.max(r.width, 380);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    list.style.left = `${Math.max(8, left)}px`;
    list.style.top = `${r.bottom + 2}px`;
    list.style.width = `${width}px`;
  };

  function close() {
    if (!list) return;
    window.removeEventListener("scroll", position, true);
    window.removeEventListener("resize", position);
    list.remove();
    list = null;
    activeIndex = -1;
    currentRefs = [];
  }

  function open() {
    if (list) return;
    list = document.createElement("ul");
    list.className = `case-by-case case-by-case-autocomplete-list ${isDarkTheme() ? "case-by-case-theme-dark" : "case-by-case-theme-light"}`;
    document.body.appendChild(list);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    position();
  }

  function render() {
    if (!list) return;
    list.innerHTML = "";
    currentRefs.forEach((ref, i) => {
      const li = document.createElement("li");
      li.className = "case-by-case-autocomplete-item" + (i === activeIndex ? " active" : "");
      const code = document.createElement("code");
      code.textContent = ref.token;
      const label = document.createElement("span");
      label.textContent = ref.label;
      li.append(code, label);
      // Use mousedown so blur does not close the list first.
      li.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        accept(ref);
      });
      list.appendChild(li);
    });
  }

  function currentTokenQuery() {
    const value = input.value.slice(0, input.selectionStart ?? input.value.length);
    const m = TOKEN_RE.exec(value);
    return m ? m[1] : null;
  }

  function accept(ref) {
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret);
    const after = input.value.slice(caret);
    const m = TOKEN_RE.exec(before);
    if (!m) return;
    const start = before.length - m[0].length;
    input.value = before.slice(0, start) + ref.token + after;
    const newCaret = start + ref.token.length;
    input.setSelectionRange(newCaret, newCaret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    close();
    input.focus();
  }

  function update() {
    const query = currentTokenQuery();
    if (query === null) { close(); return; }
    currentRefs = rankRefs(query);
    if (!currentRefs.length) { close(); return; }
    activeIndex = 0;
    open();
    position();
    render();
  }

  input.addEventListener("input", update);
  input.addEventListener("click", update);

  input.addEventListener("keydown", (ev) => {
    if (!list || !currentRefs.length) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      activeIndex = (activeIndex + 1) % currentRefs.length;
      render();
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      activeIndex = (activeIndex - 1 + currentRefs.length) % currentRefs.length;
      render();
    } else if (ev.key === "Enter" || ev.key === "Tab") {
      if (activeIndex >= 0) {
        ev.preventDefault();
        accept(currentRefs[activeIndex]);
      }
    } else if (ev.key === "Escape") {
      close();
    }
  });

  input.addEventListener("blur", () => {
    const fixed = autoParenFormula(input.value);
    if (fixed !== input.value) {
      input.value = fixed;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close();
  });
}
