/** case-by-case formula helpers. */

/**
 * Resolve a bonus formula against roll data.
 * Item data only fills scaling and item refs.
 */
// Stand-in for "@consumed" during resolution; restored before return.
const CONSUMED_PLACEHOLDER = "__CB_CONSUMED__";

export function resolveFormula(formula, actor, item = null, { warn = true } = {}) {
  try {
    // Keep @consumed literal here; it is filled in later.
    const hasConsumed = /@consumed\b/.test(formula);
    const protectedFormula = hasConsumed ? formula.replace(/@consumed\b/g, CONSUMED_PLACEHOLDER) : formula;

    const rollData = actor.getRollData();
    if (item) {
      try {
        const itemData = item.getRollData();
        rollData.scaling = itemData.scaling;
        rollData.item = itemData.item;
      } catch (err) {
        console.warn(`case-by-case | resolveFormula: couldn't merge item roll data for "${formula}":`, err);
      }
    }
    // Reject object refs early.
    const refRgx = /@([a-zA-Z0-9_.-]+)/g;
    let match;
    while ((match = refRgx.exec(protectedFormula))) {
      const ref = match[1];
      // Reject bare @prof and point to numeric proficiency paths.
      if (ref === "prof") {
        console.warn(`case-by-case | resolveFormula: "@prof" isn't supported directly. Use "@attributes.prof" for your flat proficiency bonus, or "@prof.flat" / "@prof.dice" / "@prof.multiplier" for the Proficiency Dice variant fields.`);
        return null;
      }
      const value = foundry.utils.getProperty(rollData, ref);
      if (value !== null && typeof value === "object") {
        console.warn(`case-by-case | resolveFormula: "@${ref}" resolves to a whole data object, not a number. Use a more specific path (e.g. "@${ref}.level").`);
        return null;
      }
    }

    const resolved = Roll.replaceFormulaData(protectedFormula, rollData, { warn });
    return hasConsumed ? resolved.split(CONSUMED_PLACEHOLDER).join("@consumed") : resolved;
  } catch (err) {
    console.error(`case-by-case | resolveFormula failed for "${formula}":`, err);
    return null;
  }
}

/** Replace @consumed with a literal amount. */
export function substituteConsumed(formula, amount) {
  const n = Math.max(0, Number(amount) || 0);
  return String(formula ?? "0").replace(/@consumed\b/g, String(n));
}
