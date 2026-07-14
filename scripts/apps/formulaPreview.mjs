/** Live "Resolves to" parse preview for formula inputs. */

import { resolveFormula, substituteConsumed } from "../formulaResolve.mjs";

/**
 * @param {HTMLInputElement} input the formula field.
 * @param {HTMLElement} previewEl Preview output element.
 * @param {Actor|null} actor Actor used for @ref resolution.
 * @param {Item|null} [item] Item used for @scaling and @item.* data.
 * @param {() => number|null} [getConsumedAmount] Preview-only value for `@consumed`, so the
 *   parser does not warn on a pseudo-variable that only exists in case-by-case.
 */
export function attachFormulaPreview(input, previewEl, actor, item = null, getConsumedAmount = null) {
  if (!input || !previewEl || input.dataset.cbPreviewBound) return;
  input.dataset.cbPreviewBound = "1";

  function update() {
    let raw = String(input.value ?? "").trim();
    if (!raw) {
      previewEl.textContent = "";
      previewEl.classList.remove("case-by-case-preview-error");
      return;
    }
    if (!actor) {
      previewEl.textContent = "Preview unavailable: no actor to resolve @refs against.";
      previewEl.classList.remove("case-by-case-preview-error");
      return;
    }
    const consumedAmount = getConsumedAmount?.();
    if (consumedAmount != null) raw = substituteConsumed(raw, consumedAmount);
    // Debounced typing preview: avoid notification spam on partial refs.
    const resolved = resolveFormula(raw, actor, item, { warn: false });
    if (resolved == null) {
      previewEl.textContent = "Couldn't resolve this formula. Check the console for details.";
      previewEl.classList.add("case-by-case-preview-error");
      return;
    }
    try {
      // Parse only (no roll), and show Roll-normalized final formula text.
      const roll = new Roll(resolved);
      previewEl.textContent = `Resolves to: ${roll.formula}`;
      previewEl.classList.remove("case-by-case-preview-error");
    } catch {
      previewEl.textContent = "Couldn't parse this formula. Check for a typo or unbalanced parentheses.";
      previewEl.classList.add("case-by-case-preview-error");
    }
  }

  // Debounce so mid-typing partial formulas do not flash errors constantly.
  let timer = null;
  function scheduleUpdate() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(update, 500);
  }

  input.addEventListener("input", scheduleUpdate);
  update();
}