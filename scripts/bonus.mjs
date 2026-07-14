/** case-by-case bonus storage helpers. */

const MODULE_ID = "case-by-case";
const FLAG_KEY  = "bonuses";

/** Rolls that can be foe-filtered. */
// Heal/temp HP use the same roll path as damage.
export const TARGETABLE_TYPES = new Set(["attack", "damage", "critRange", "heal", "temphp"]);

/** Bonus types that can use a non-simple mod. */
export const MOD_TYPE_DICE_TYPES = new Set(["save", "check", "skill", "attack", "death", "hitDie", "initiative", "damage", "heal", "temphp"]);

/** Bonus types with a real dice pool. */
export const MOD_TYPE_POOL_TYPES = new Set(["damage", "heal", "temphp", "hitDie"]);

/** Get the legal mod types for a bonus type. */
export function modTypesFor(type) {
  const out = ["simple"];
  if (MOD_TYPE_DICE_TYPES.has(type)) out.push("reroll", "minDie");
  if (MOD_TYPE_POOL_TYPES.has(type)) out.push("explode", "maxDie", "resize");
  return out;
}

/** Check for foe filters. */
export function hasFoeFilters(f = {}) {
  return !!(f.foeConditions?.length || f.foeTypes?.length || f.foeSizes?.length
    || f.foeMovement?.length || f.foeLanguages?.length
    || f.foeWithin != null || f.foeBloodied != null || f.foeEffectName?.trim());
}

/** Check whether a multipart group mixes targetable child types. */
function _childTypesCompatible(children) {
  if (children.length < 2) return true;
  const first = TARGETABLE_TYPES.has(children[0].type);
  return children.every(c => TARGETABLE_TYPES.has(c.type) === first);
}

// Document -> { rawRef, normalized }. Foundry replaces the whole flag array on write, so
// reference checks are enough to detect changes. WeakMap handles cleanup for deleted documents.
const _bonusCache = new WeakMap();
// Stable stand-in for "no flag set" so empty sources still hit the cache.
const _NO_FLAG = [];

/**
 * Clone and normalize a document's bonuses, reusing cached data until the flag array changes.
 * The returned array is shared read-only cache data; use getBonuses for a safe copy.
 */
function _readCachedBonuses(document) {
  const raw = document.getFlag(MODULE_ID, FLAG_KEY) ?? _NO_FLAG;
  const cached = _bonusCache.get(document);
  if (cached && cached.rawRef === raw) return cached.normalized;
  const normalized = foundry.utils.deepClone(raw).map(_normalizeBonus);
  _bonusCache.set(document, { rawRef: raw, normalized });
  return normalized;
}

/**
 * Read-only bonus access for hot paths. Do not mutate the returned array or bonus objects.
 */
export function peekBonuses(document) {
  if (!document) return [];
  return _readCachedBonuses(document);
}

/** Get cloned, normalized bonuses from a document -- safe to mutate and discard. */
export function getBonuses(document) {
  if (!document) return [];
  return foundry.utils.deepClone(_readCachedBonuses(document));
}

/** Normalize advantage/disadvantage bonuses on read. */
function _normalizeBonus(bonus) {
  if (bonus && bonus.kind !== "multipart" && (bonus.type === "advantage" || bonus.type === "disadvantage")) {
    const grantsMode = bonus.grantsMode ?? true;
    bonus.advantage = bonus.type === "advantage" && grantsMode;
    bonus.disadvantage = bonus.type === "disadvantage" && grantsMode;
    bonus.bonus = "0";
  }
  // Spell Save DC is passive, so keep it automatic, local, and free of foe filtering.
  if (bonus && bonus.kind !== "multipart" && bonus.type === "saveDC") {
    bonus.optional = false;
    if (bonus.aura) bonus.aura.enabled = false;
    if (bonus.filters) {
      Object.assign(bonus.filters, {
        foeConditions: [], foeTypes: [], foeSizes: [], foeMovement: [], foeLanguages: [],
        foeWithin: null, foeBloodied: null, foeEffectName: "",
      });
    }
  }
  // Delayed group prompts only make sense for targetable child types. Everything else falls back
  // to per-roll prompting so children do not get stranded in the carry stash.
  if (bonus?.kind === "multipart" && Array.isArray(bonus.children) && bonus.children.length
      && bonus.children.every(c => !TARGETABLE_TYPES.has(c.type))
      && (bonus.promptTiming ?? "associated") !== "associated") {
    bonus.promptTiming = "associated";
  }
  // Backfill consumption and disable it when it cannot apply.
  if (bonus) {
    bonus.consumption = foundry.utils.mergeObject(
      { enabled: false, type: "uses", target: "", min: 1, max: 1 },
      bonus.consumption ?? {},
      { overwrite: true, inplace: false },
    );
    if (!bonus.optional) bonus.consumption.enabled = false;
    if (bonus.kind === "multipart" && (bonus.promptTiming ?? "associated") === "associated") {
      bonus.consumption.enabled = false;
    }
  }
  // Reset illegal mod types to simple. Foe-filtered damage/heal/temp HP is always simple.
  if (bonus) {
    const foeFilteredModTypeless = ["damage", "heal", "temphp"].includes(bonus.type) && hasFoeFilters(bonus.filters);
    const allowed = bonus.kind === "multipart" ? ["simple"] : modTypesFor(bonus.type);
    if (foeFilteredModTypeless || !allowed.includes(bonus.modType)) bonus.modType = "simple";
  }
  // Normalize each child the same way as a top-level bonus.
  if (bonus?.kind === "multipart" && Array.isArray(bonus.children)) {
    bonus.children = bonus.children.map(_normalizeChild);
  }
  return bonus;
}

/** Normalize one multipart child. */
function _normalizeChild(child) {
  if (!child) return child;
  child.filters = foundry.utils.mergeObject(defaultFilters(), child.filters ?? {}, { overwrite: true, inplace: false });
  // Same foe-filtered damage/heal/temp HP lock as _normalizeBonus.
  const foeFilteredModTypeless = ["damage", "heal", "temphp"].includes(child.type) && hasFoeFilters(child.filters);
  const allowed = modTypesFor(child.type);
  if (foeFilteredModTypeless || !allowed.includes(child.modType)) child.modType = "simple";
  return child;
}

/** Collect bonus sources from an actor. */
export function collectBonusSources(actor) {
  if (!actor) return [];
  const effects = Array.from(actor.allApplicableEffects()).filter(e => !e.disabled && !e.isSuppressed);
  return [actor, ...actor.items.contents, ...effects];
}

/** Overwrite the entire bonuses array on a document. */
export async function setBonuses(document, bonuses) {
  await document.setFlag(MODULE_ID, FLAG_KEY, bonuses);
}

/**
 * Add a new bonus to a document.
 * @param {foundry.abstract.Document} document
 * @param {Partial<BonusSchema>} bonusData - merged over defaults
 * @returns {object} the created bonus (with generated id)
 */
export async function addBonus(document, bonusData = {}) {
  const bonuses = getBonuses(document);
  const bonus = foundry.utils.mergeObject(defaultBonus(), bonusData, { overwrite: true, inplace: false });
  bonus.id = foundry.utils.randomID(12);
  bonuses.push(bonus);
  await setBonuses(document, bonuses);
  return bonus;
}

/**
 * Remove a bonus by id.
 * @param {foundry.abstract.Document} document
 * @param {string} bonusId
 */
export async function removeBonus(document, bonusId) {
  const bonuses = getBonuses(document).filter(b => b.id !== bonusId);
  await setBonuses(document, bonuses);
}

/**
 * Update fields on an existing bonus.
 * @param {foundry.abstract.Document} document
 * @param {string} bonusId
 * @param {object} updates - partial bonus data (merged)
 */
export async function updateBonus(document, bonusId, updates) {
  const bonuses = getBonuses(document);
  const idx = bonuses.findIndex(b => b.id === bonusId);
  if (idx === -1) {
    console.warn(`case-by-case | updateBonus: bonus "${bonusId}" not found on`, document);
    return;
  }
  bonuses[idx] = foundry.utils.mergeObject(bonuses[idx], updates, { overwrite: true, inplace: false });
  await setBonuses(document, bonuses);
  return bonuses[idx];
}

/**
 * Default child for a multipart bonus.
 * Uses the same filter shape as a simple bonus and keeps its own mod type.
 */
export function defaultChild() {
  return { id: "", name: "Part", type: "attack", bonus: "0", modType: "simple", filters: defaultFilters() };
}

/**
 * Add a child to a multipart parent.
 * Refuses type mixes that combine targetable and non-targetable child types.
 */
export async function addChild(document, parentId, childData = {}) {
  const parent = getBonuses(document).find(b => b.id === parentId);
  if (!parent) return;
  const child = foundry.utils.mergeObject(defaultChild(), childData, { overwrite: true, inplace: false });
  child.id = foundry.utils.randomID(12);
  const children = [...(parent.children ?? []), child];
  if (!_childTypesCompatible(children)) {
    console.warn(`case-by-case | addChild: type "${child.type}" mixes targetable and non-targetable roll types within group "${parent.name}". Refusing.`);
    return;
  }
  await updateBonus(document, parentId, { children });
  return child;
}

/** Update a child sub-bonus. Uses the same type-mixing guard as addChild. */
export async function updateChild(document, parentId, childId, updates) {
  const parent = getBonuses(document).find(b => b.id === parentId);
  if (!parent) return;
  const children = (parent.children ?? []).map(c =>
    c.id === childId ? foundry.utils.mergeObject(c, updates, { overwrite: true, inplace: false }) : c);
  if (!_childTypesCompatible(children)) {
    console.warn(`case-by-case | updateChild: resulting type mix is invalid within group "${parent.name}". Refusing.`);
    return;
  }
  await updateBonus(document, parentId, { children });
}

/** Remove a child sub-bonus. */
export async function removeChild(document, parentId, childId) {
  const parent = getBonuses(document).find(b => b.id === parentId);
  if (!parent) return;
  const children = (parent.children ?? []).filter(c => c.id !== childId);
  await updateBonus(document, parentId, { children });
}

/**
 * Default filters object for simple bonuses and multipart children.
 */
function defaultFilters() {
  return {
    abilities: [],
    skills: [],
    // Only used for advantage/disadvantage types (parent-only; children can't be that type).
    rollKinds: [],
    attackModes: [],
    itemTypes: [],
    spellSchools: [],
    minSpellLevel: null,
    maxSpellLevel: null,
    targetConditions: [],
    actorConditions: [],
    comparison: "",
    // Proficiency filter for save/check/skill bonuses.
    // "" | "proficient" | "expertise" | "either" | "none"
    proficiency: "",
    // Recipient filters (self/aura recipient).
    targetTypes: [],      // creature type
    targetSizes: [],      // size
    targetMovement: [],   // movement type with speed > 0
    targetLanguages: [],  // known language
    targetBloodied: null, // recipient HP <= this % of max (null = off)
    targetEffectName: "", // recipient has effect name containing this text
    targetEffectActiveOnly: true, // require that effect to be active
    // Foe filters (actual roll target).
    foeConditions: [],    // statuses
    foeTypes: [],         // creature type
    foeSizes: [],         // size
    foeMovement: [],      // movement type with speed > 0
    foeLanguages: [],     // known language
    foeWithin: null,      // target is within this many feet of the roller
    foeBloodied: null,    // target HP <= this % of max (null = off)
    foeEffectName: "",    // target has effect name containing this text
    foeEffectActiveOnly: true, // require that foe effect to be active
    // Item/caster filters.
    damageTypes: [],      // activity deals one of these damage types
    weaponProps: [],      // weapon has one of these properties
    spellComponents: [],  // spell has one of these components
    minSlots: null,       // caster has at least this many spell slots available
    maxSlots: null,       // caster has at most this many spell slots available
  };
}

/** Default bonus structure (a "simple" bonus). */
function defaultBonus() {
  return {
    id: "",
    name: "New Bonus",
    enabled: true,
    kind: "simple",          // "simple" | "multipart"
    optional: false,
    stackTag: "",
    type: "save",
    bonus: "0",
    modType: "simple",
    advantage: false,
    disadvantage: false,
    // Used by advantage/disadvantage types.
    grantsMode: true,
    additionalD20: "0",
    // Item-hosted only: require the same item.
    scopeToHostItem: false,
    // Multipart-only fields.
    promptTiming: "associated", // "associated" | "attack" | "damage"
    children: [],               // [{ id, name, type, bonus, modType, filters }] -- see defaultChild
    // Group-level filters; each child still checks its own filters too.
    filters: defaultFilters(),
    aura: {
      enabled: false,
      range: 10,
      disposition: 1,
      self: true,
      requiresConsciousness: true,
      blockedStatuses: [],
      color: "#4a90d9",
      showRadius: false,
    },
    // Optional cost config. Multipart uses one shared timed cost.
    consumption: {
      enabled: false,
      type: "uses",
      target: "",
      min: 1,
      max: 1,
    },
  };
}
