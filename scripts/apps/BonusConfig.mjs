/**
 * case-by-case bonus editor helpers.
 * This file only holds option lists and pure formatting helpers.
 */

import { TARGETABLE_TYPES, modTypesFor } from "../bonus.mjs";

// Option lists

export const TYPES = [
  { value: "save",         label: "Saving Throw" },
  { value: "saveDC",       label: "Spell Save DC" },
  { value: "check",        label: "Ability Check" },
  { value: "skill",        label: "Skill Check" },
  { value: "attack",       label: "Attack Roll" },
  { value: "damage",       label: "Damage Roll" },
  { value: "heal",         label: "Healing Roll" },
  { value: "temphp",       label: "Temporary HP Roll" },
  { value: "critRange",    label: "Critical Range" },
  { value: "death",        label: "Death Save" },
  { value: "hitDie",       label: "Hit Die" },
  { value: "initiative",   label: "Initiative" },
  { value: "advantage",    label: "Advantage" },
  { value: "disadvantage", label: "Disadvantage" },
];

// Child sub-bonuses cannot use advantage/disadvantage.
export const CHILD_TYPES = TYPES.filter(t => t.value !== "advantage" && t.value !== "disadvantage");

/** Roll kinds for Advantage/Disadvantage bonuses. */
export const ROLL_KINDS = [
  { value: "save",       label: "Saving Throw" },
  { value: "check",      label: "Ability Check" },
  { value: "skill",      label: "Skill Check" },
  { value: "attack",     label: "Attack Roll" },
  { value: "death",      label: "Death Save" },
  { value: "hitDie",     label: "Hit Die" },
  { value: "initiative", label: "Initiative" },
];

/** Labels for modification types. */
export const MOD_TYPE_LABELS = {
  simple:  "Simple Bonus",
  reroll:  "Reroll",
  minDie:  "Minimum Die Value",
  maxDie:  "Maximum Die Value",
  explode: "Explode",
  resize:  "Resize",
};

/** Build the valid mod-type options. */
export function modTypeOptionsFor(type, selected) {
  const allowed = modTypesFor(type);
  return allowed.map(value => ({ value, label: MOD_TYPE_LABELS[value], selected: value === selected }));
}

export const DISPOSITIONS = [
  { value: "1",  label: "Allies" },
  { value: "-1", label: "Enemies" },
  { value: "0",  label: "Everyone" },
];

export const TIMINGS = [
  { value: "associated", label: "Ask before each associated roll" },
  { value: "attack",     label: "Ask before the attack roll" },
  { value: "damage",     label: "Ask before the damage roll" },
];

export const ABILITIES = [
  { value: "str", label: "Strength" },     { value: "dex", label: "Dexterity" },
  { value: "con", label: "Constitution" }, { value: "int", label: "Intelligence" },
  { value: "wis", label: "Wisdom" },       { value: "cha", label: "Charisma" },
];

export const SPELL_SCHOOLS = [
  { value: "abj", label: "Abjuration" },   { value: "con", label: "Conjuration" },
  { value: "div", label: "Divination" },   { value: "enc", label: "Enchantment" },
  { value: "evo", label: "Evocation" },    { value: "ill", label: "Illusion" },
  { value: "nec", label: "Necromancy" },   { value: "trs", label: "Transmutation" },
];

export const ITEM_TYPES = [
  { value: "weapon", label: "Weapon" },        { value: "spell", label: "Spell" },
  { value: "feat", label: "Feature/Feat" },    { value: "equipment", label: "Equipment" },
  { value: "consumable", label: "Consumable" }, { value: "tool", label: "Tool" },
  { value: "loot", label: "Loot" },
];

export const ATTACK_MODES = [
  { value: "mwak", label: "Melee Weapon" },  { value: "rwak", label: "Ranged Weapon" },
  { value: "msak", label: "Melee Spell" },   { value: "rsak", label: "Ranged Spell" },
];

export const PROFICIENCY_OPTIONS = [
  { value: "",           label: "(any)" },
  { value: "proficient", label: "Proficient" },
  { value: "expertise",  label: "Expertise" },
  { value: "either",     label: "Either (any proficiency bonus)" },
  { value: "none",       label: "None (untrained)" },
];

export const CONDITIONS = [
  { value: "blinded",       label: "Blinded" },       { value: "charmed",       label: "Charmed" },
  { value: "deafened",      label: "Deafened" },       { value: "exhaustion",    label: "Exhaustion" },
  { value: "frightened",    label: "Frightened" },     { value: "grappled",      label: "Grappled" },
  { value: "incapacitated", label: "Incapacitated" },  { value: "invisible",     label: "Invisible" },
  { value: "paralyzed",     label: "Paralyzed" },      { value: "petrified",     label: "Petrified" },
  { value: "poisoned",      label: "Poisoned" },       { value: "prone",         label: "Prone" },
  { value: "restrained",    label: "Restrained" },     { value: "stunned",       label: "Stunned" },
  { value: "unconscious",   label: "Unconscious" },    { value: "dead",          label: "Dead" },
  { value: "cursed",        label: "Cursed" },
];

/** dnd5e skills, with a fallback list. */
export function skillList() {
  const cfg = CONFIG?.DND5E?.skills;
  if (cfg) return Object.entries(cfg).map(([value, s]) => ({ value, label: game.i18n?.localize(s.label) ?? s.label }));
  return [
    { value: "acr", label: "Acrobatics" },  { value: "ani", label: "Animal Handling" },
    { value: "arc", label: "Arcana" },       { value: "ath", label: "Athletics" },
    { value: "dec", label: "Deception" },    { value: "his", label: "History" },
    { value: "ins", label: "Insight" },      { value: "itm", label: "Intimidation" },
    { value: "inv", label: "Investigation" },{ value: "med", label: "Medicine" },
    { value: "nat", label: "Nature" },       { value: "prc", label: "Perception" },
    { value: "prf", label: "Performance" },  { value: "per", label: "Persuasion" },
    { value: "rel", label: "Religion" },     { value: "slt", label: "Sleight of Hand" },
    { value: "ste", label: "Stealth" },      { value: "sur", label: "Survival" },
  ];
}

/** Localize a CONFIG.DND5E entry. */
const _loc = (v, key) => game.i18n?.localize(typeof v === "string" ? v : (v?.label ?? key)) ?? key;

/** Build CONFIG-backed option lists. */
export function creatureTypeList() {
  const cfg = CONFIG?.DND5E?.creatureTypes;
  if (!cfg) return ["aberration","beast","celestial","construct","dragon","elemental","fey","fiend","giant","humanoid","monstrosity","ooze","plant","undead"].map(v => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));
  return Object.entries(cfg).map(([value, v]) => ({ value, label: _loc(v, value) }));
}
export function sizeList() {
  const cfg = CONFIG?.DND5E?.actorSizes;
  if (!cfg) return [["tiny","Tiny"],["sm","Small"],["med","Medium"],["lg","Large"],["huge","Huge"],["grg","Gargantuan"]].map(([value,label]) => ({ value, label }));
  return Object.entries(cfg).map(([value, v]) => ({ value, label: _loc(v, value) }));
}
export function movementList() {
  const cfg = CONFIG?.DND5E?.movementTypes;
  const base = cfg ? Object.entries(cfg).map(([value, v]) => ({ value, label: _loc(v, value) }))
                   : [["walk","Walk"],["fly","Fly"],["swim","Swim"],["climb","Climb"],["burrow","Burrow"]].map(([value,label]) => ({ value, label }));
  return base;
}
export function languageList() {
  const cfg = CONFIG?.DND5E?.languages;
  if (!cfg) return [["common","Common"],["draconic","Draconic"],["elvish","Elvish"],["dwarvish","Dwarvish"],["undercommon","Undercommon"],["infernal","Infernal"],["celestial","Celestial"],["abyssal","Abyssal"]].map(([value,label]) => ({ value, label }));
  const out = [];
  const walk = (node) => {
    for (const [key, v] of Object.entries(node)) {
      if (typeof v === "string") { out.push({ value: key, label: _loc(v, key) }); continue; }
      if (v?.children) {
        if (v.selectable !== false) out.push({ value: key, label: _loc(v, key) });
        walk(v.children);
      } else {
        out.push({ value: key, label: _loc(v, key) });
      }
    }
  };
  walk(cfg);
  return out;
}

export function damageTypeList() {
  const cfg = CONFIG?.DND5E?.damageTypes;
  if (!cfg) return ["acid","bludgeoning","cold","fire","force","lightning","necrotic","piercing","poison","psychic","radiant","slashing","thunder"].map(v => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));
  return Object.entries(cfg).map(([value, v]) => ({ value, label: _loc(v, value) }));
}
export function weaponPropList() {
  const props = CONFIG?.DND5E?.itemProperties ?? {};
  const valid = CONFIG?.DND5E?.validProperties?.weapon;
  const keys = valid instanceof Set ? [...valid] : Object.keys(props);
  return keys.map(k => ({ value: k, label: _loc(props[k], k) }));
}
export function spellComponentList() {
  const props = CONFIG?.DND5E?.itemProperties ?? {};
  const valid = CONFIG?.DND5E?.validProperties?.spell;
  const keys = valid instanceof Set ? [...valid] : ["vocal","somatic","material","concentration","ritual"];
  return keys.map(k => ({ value: k, label: _loc(props[k], k) }));
}

/** Mark selected options. */
export const withSelected = (list, arr) => list.map(o => ({ ...o, selected: arr.includes(o.value) }));

/** Split a transfer list into available and selected. */
export function splitOptions(list, selectedArr = []) {
  const selSet    = new Set(selectedArr);
  const available = list.filter(o => !selSet.has(o.value));
  const selected  = selectedArr.map(v => list.find(o => o.value === v)).filter(Boolean);
  return { available, selected, enabled: selected.length > 0 };
}

/** Default working-copy shape for a bonus (or child pseudo-bonus) being edited. */
export function defaultData() {
  return {
    name: "", enabled: true, optional: false, stackTag: "",
    type: "save", bonus: "0", modType: "simple", scopeToHostItem: false,
    advantage: false, disadvantage: false, grantsMode: true, additionalD20: "0",
    filters: {
      abilities: [], skills: [], rollKinds: [], attackModes: [], itemTypes: [],
      spellSchools: [], minSpellLevel: null, maxSpellLevel: null,
      targetConditions: [], actorConditions: [], comparison: "",
      targetTypes: [], targetSizes: [], targetMovement: [], targetLanguages: [],
      damageTypes: [], weaponProps: [], spellComponents: [], minSlots: null, maxSlots: null,
    },
    aura: {
      enabled: false, range: 10, disposition: 1, self: true,
      requiresConsciousness: true, blockedStatuses: [], color: "#4a90d9",
    },
    consumption: { enabled: false, type: "uses", target: "", min: 1, max: 1 },
  };
}

// Re-export for convenience so callers only need one import from this module.
export { TARGETABLE_TYPES };
