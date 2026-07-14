/** Consumption category/resource dropdown helpers for BonusConfig. */

/** Category options for consumption.type. */
export const CONSUMPTION_CATEGORIES = [
  { value: "uses",      label: "Limited Uses (feature/item charges)" },
  { value: "quantity",  label: "Item Quantity" },
  { value: "resource",  label: "Resource (Primary/Secondary/Tertiary)" },
  { value: "spellSlot", label: "Spell Slot" },
  { value: "hp",        label: "Hit Points" },
  { value: "currency",  label: "Currency" },
  { value: "effect",    label: "This Effect" },
];

/**
 * Resolve `uses.max` to a plain number when possible.
 * Returns null when the formula still is not a clean number.
 */
function _resolvedUsesMax(item) {
  const raw = item.system?.uses?.max;
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return raw;
  try {
    const resolved = Roll.replaceFormulaData(String(raw), item.getRollData(), { missing: "0", warn: false });
    const n = Number(resolved);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Build categorized consumable resources for actor/host context. */
export function scanConsumableResources(actor, hostDocument) {
  const groups = [];
  if (!actor) return groups;

  // Limited Uses
  const usesEntries = [];
  for (const item of actor.items ?? []) {
    const uses = item.system?.uses;
    if (!uses) continue;
    const max = _resolvedUsesMax(item);
    // If the formula still is not a plain number, fall back to a raw presence check.
    const hasUses = max !== null ? max > 0
      : uses.max != null && uses.max !== "" && uses.max !== 0 && uses.max !== "0";
    if (hasUses) usesEntries.push({ target: item.id, label: item.name, sub: `${uses.value ?? 0}/${max ?? uses.max}` });
  }
  if (usesEntries.length) groups.push({ type: "uses", label: "Limited Uses", entries: usesEntries });

  // Item Quantity
  const quantityEntries = [];
  for (const item of actor.items ?? []) {
    const qty = item.system?.quantity;
    if (typeof qty === "number" && qty > 0) quantityEntries.push({ target: item.id, label: item.name, sub: `×${qty}` });
  }
  if (quantityEntries.length) groups.push({ type: "quantity", label: "Item Quantity", entries: quantityEntries });

  // Generic resources
  const resourceEntries = [];
  const resources = actor.system?.resources ?? {};
  for (const slot of ["primary", "secondary", "tertiary"]) {
    const r = resources[slot];
    if (r?.max) resourceEntries.push({
      target: slot,
      label: r.label || `${slot[0].toUpperCase()}${slot.slice(1)} Resource`,
      sub: `${r.value ?? 0}/${r.max}`,
    });
  }
  if (resourceEntries.length) groups.push({ type: "resource", label: "Resources", entries: resourceEntries });

  // Spell slots
  const spellEntries = [];
  const spells = actor.system?.spells ?? {};
  for (const [key, s] of Object.entries(spells)) {
    if (!s?.max) continue;
    const label = key === "pact" ? "Pact Magic"
      : (CONFIG?.DND5E?.spellLevels?.[s.level ?? key.replace("spell", "")] ?? key);
    spellEntries.push({ target: key, label, sub: `${s.value ?? 0}/${s.max}` });
  }
  if (spellEntries.length) {
    groups.push({
      type: "spellSlot", label: "Spell Slots",
      // "Any" defers the slot choice until prompt time.
      entries: [{ target: "any", label: "Any Available Slot", sub: "player picks the level when prompted" }, ...spellEntries],
    });
  }

  // Hit points. Always available.
  const hp = actor.system?.attributes?.hp;
  if (hp) groups.push({
    type: "hp", label: "Hit Points",
    entries: [{ target: "", label: "Hit Points", sub: `${hp.value ?? 0}/${hp.max ?? 0}` }],
  });

  // Currency. Always available.
  const currency = actor.system?.currency ?? {};
  const denominations = [["pp", "Platinum"], ["gp", "Gold"], ["ep", "Electrum"], ["sp", "Silver"], ["cp", "Copper"]];
  groups.push({
    type: "currency", label: "Currency",
    entries: denominations.map(([key, label]) => ({ target: key, label, sub: `${currency[key] ?? 0}` })),
  });

  // This bonus's hosting effect, if the host really is an effect.
  if (hostDocument instanceof ActiveEffect) {
    groups.push({
      type: "effect", label: "This Effect",
      entries: [{ target: "", label: hostDocument.name, sub: "deletes the effect when spent" }],
    });
  }

  return groups;
}

/** Get option records for one consumption category. */
export function resourceOptionsFor(actor, hostDocument, type) {
  const group = scanConsumableResources(actor, hostDocument).find(g => g.type === type);
  return (group?.entries ?? []).map(e => ({ value: e.target, label: `${e.label} (${e.sub})` }));
}

/** Rebuild target options when consumption category changes. */
export function attachResourceCategorySelect(categorySelect, targetSelect, actor, hostDocument) {
  if (!categorySelect || !targetSelect || categorySelect.dataset.cbResourceBound) return;
  categorySelect.dataset.cbResourceBound = "1";

  categorySelect.addEventListener("change", () => {
    const options = resourceOptionsFor(actor, hostDocument, categorySelect.value);
    targetSelect.innerHTML = "";
    if (!options.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = actor ? "None found on this actor" : "No actor to scan";
      opt.disabled = true;
      targetSelect.appendChild(opt);
    } else {
      for (const o of options) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        targetSelect.appendChild(opt);
      }
    }
    targetSelect.disabled = !options.length;
    targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
}