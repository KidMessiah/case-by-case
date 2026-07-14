/** case-by-case roll-data refs. */

const ABILITIES = [
  ["str", "Strength"],
  ["dex", "Dexterity"],
  ["con", "Constitution"],
  ["int", "Intelligence"],
  ["wis", "Wisdom"],
  ["cha", "Charisma"],
];

function abilityRefs() {
  const refs = [];
  for (const [key, name] of ABILITIES) {
    const lower = name.toLowerCase();
    refs.push(
      { token: `@abilities.${key}.mod`, label: `${name} Modifier`, keywords: [lower, "modifier", "mod", "bonus"] },
      { token: `@abilities.${key}.value`, label: `${name} Score`, keywords: [lower, "score", "value"] },
      { token: `@abilities.${key}.save.value`, label: `${name} Save Bonus`, keywords: [lower, "save", "saving throw"] },
      { token: `@abilities.${key}.checkBonus`, label: `${name} Check Bonus`, keywords: [lower, "check", "ability check"] },
      { token: `@abilities.${key}.dc`, label: `${name}-Based DC`, keywords: [lower, "dc", "save dc"] },
    );
  }
  return refs;
}

export const ROLL_DATA_REFS = [
  // Do not offer bare "@prof"; use numeric proficiency paths instead.
  { token: "@attributes.prof", label: "Proficiency Bonus (flat)", keywords: ["proficiency", "prof", "prof bonus"] },
  { token: "@prof.flat", label: "Proficiency Bonus (flat, Proficiency Dice variant)", keywords: ["proficiency", "prof", "proficiency dice", "flat"] },
  { token: "@prof.dice", label: "Proficiency Dice (e.g. 1d4)", keywords: ["proficiency", "prof", "proficiency dice", "dice"] },
  { token: "@prof.multiplier", label: "Proficiency Multiplier (0 / 0.5 / 1 / 2)", keywords: ["proficiency", "prof", "multiplier", "expertise", "half proficiency", "jack of all trades"] },
  ...abilityRefs(),
  { token: "@details.level", label: "Character Level (total)", keywords: ["level", "character level", "total level"] },
  { token: "@attributes.spell.dc", label: "Spell Save DC", keywords: ["spell dc", "save dc", "spellcasting dc"] },
  { token: "@attributes.spell.attack", label: "Spell Attack Bonus", keywords: ["spell attack", "spellcasting attack"] },
  { token: "@attributes.spell.mod", label: "Spellcasting Ability Modifier", keywords: ["spellcasting modifier", "spell mod", "spellcasting ability"] },
  { token: "@attributes.hp.value", label: "Current Hit Points", keywords: ["hp", "hit points", "current hp"] },
  { token: "@attributes.hp.max", label: "Max Hit Points", keywords: ["hp", "hit points", "max hp"] },
  { token: "@attributes.ac.value", label: "Armor Class", keywords: ["ac", "armor class", "armor"] },
  { token: "@attributes.init.mod", label: "Initiative Modifier", keywords: ["initiative", "init"] },
  { token: "@attributes.movement.walk", label: "Walking Speed", keywords: ["speed", "movement", "walk"] },
  { token: "@resources.primary.value", label: "Primary Resource (Current)", keywords: ["resource", "primary"] },
  { token: "@resources.primary.max", label: "Primary Resource (Max)", keywords: ["resource", "primary", "max"] },
  { token: "@resources.secondary.value", label: "Secondary Resource (Current)", keywords: ["resource", "secondary"] },
  { token: "@resources.secondary.max", label: "Secondary Resource (Max)", keywords: ["resource", "secondary", "max"] },
  { token: "@resources.tertiary.value", label: "Tertiary Resource (Current)", keywords: ["resource", "tertiary"] },
  { token: "@resources.tertiary.max", label: "Tertiary Resource (Max)", keywords: ["resource", "tertiary", "max"] },
  { token: "@scaling.increase", label: "Spell Upcast Levels (above minimum, 0-based)", keywords: ["upcast", "scaling", "levels above", "spell level"] },
  { token: "@scaling.value", label: "Spell Upcast Levels (1-based)", keywords: ["upcast", "scaling", "spell level"] },
  { token: "@item.level", label: "Spell's Actual Cast Level (with upcasting)", keywords: ["spell level", "cast level", "actual level", "upcast level"] },
];
