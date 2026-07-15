/** case-by-case roll hooks. */

import { peekBonuses, collectBonusSources, hasFoeFilters as _hasFoeFilters } from "./bonus.mjs";
import { isInAura, getDistance } from "./aura.mjs";
import { getAuraSources } from "./auraRegistry.mjs";
import { resolveFormula as _resolveFormula, substituteConsumed as _substituteConsumedShared } from "./formulaResolve.mjs";

const MODULE_ID = "case-by-case";
const MAX_EXTRA_D20 = 8;
// Standard die sizes for resize.
const DIE_SIZE_PROGRESSION = [4, 6, 8, 10, 12, 20];
let _d20PatchRegistered = false;
let _d20FromConfigPatchRegistered = false;
let _diceModPatchRegistered = false;

/** Whether debug logging is on. */
function _debugOn() {
  try { return !!game.settings.get(MODULE_ID, "debug"); }
  catch { return false; } // setting not ready yet
}

/** Debug logging helper. Guard expensive payloads with _debugOn() first. */
function _debug(...args) {
  if (_debugOn()) console.log(...args);
}

// Initiative choices cached for the next config pass.
const _pendingInitiativeChoices = new Map(); // actor.uuid -> gathered bonus records[]

/** Shared attack/damage stash, lets required and accepted optional bonuses dedupe before the roll fires. */
const _pendingActivityBonuses = new Map(); // useKey -> deduplicated bonus records[]

// Multipart carry stash.

const _pending = new Map();          // useKey -> { ts, parents: Map<parentId, child[]> }
const PENDING_TTL = 120000;          // ms

/**
 * Key for this roll: message first, then live workflow cache, then midi's registry, then generation counter.
 *
 * @param {Activity} activity
 * @param {object} [opts]
 * @param {object} [opts.message] dnd5e message config, used for `originatingMessage`.
 * @param {string} [opts.originId] Pre-resolved id, such as a live midi-qol workflow id.
 */
function _useKey(activity, { message = null, originId = null } = {}) {
  const base = activity?.uuid ?? activity?.item?.uuid ?? null;
  if (!base) return null;

  const msgOriginId = message?.data?.flags?.dnd5e?.originatingMessage
    ?? message?.flags?.dnd5e?.originatingMessage
    ?? null;
  const resolvedId = originId ?? msgOriginId;
  if (resolvedId) {
    const key = `${base}::${resolvedId}`;
    // Stringify so copied logs still include the actual values.
    _debug("case-by-case | _useKey " + JSON.stringify({ base, source: originId ? "explicit" : "originatingMessage", resolvedId, key }));
    return key;
  }

  // Cache of the live workflow, filled before this runs (see _cacheLiveWorkflow's doc).
  const liveWf = activity?.uuid ? _liveWorkflowByActivity.get(activity.uuid) : null;
  const liveTag = _tagForWorkflow(liveWf);
  if (liveTag) {
    const key = `${base}::wf:${liveTag}`;
    _debug("case-by-case | _useKey " + JSON.stringify({ base, source: "liveWorkflowCache", liveTag, key }));
    return key;
  }

  // Backup check against midi's own workflow registry, though it's usually empty by now.
  const wf = activity?.uuid ? globalThis.MidiQOL?.Workflow?.getWorkflowByActivityUuid?.(activity.uuid) : null;
  const wfId = wf?.id ?? wf?.uuid ?? null;
  if (wfId) {
    const key = `${base}::${wfId}`;
    _debug("case-by-case | _useKey " + JSON.stringify({ base, source: "midiWorkflow", wfFound: true, wfId, key }));
    return key;
  }

  // Last resort: generation counter instead of bare uuid; warns below if midi-qol is active but the cache still failed.
  if (game.modules.get("midi-qol")?.active) {
    console.warn(
      "case-by-case | _useKey: midi-qol is active but no live workflow was cached, falling back to the generation counter. Please report this.",
      { activityUuid: activity?.uuid },
    );
  }
  const gen = _currentGeneration(activity?.uuid);
  const key = gen ? `${base}::gen${gen}` : base;
  _debug("case-by-case | _useKey " + JSON.stringify({
    base, source: gen ? "generation" : "bareUuid", wfFound: false, gen, key,
    keyAlreadyPending: _pending.has(key),
  }));
  return key;
}

// Counter per activity, used as a last-resort key in _useKey.
const _activityGeneration = new Map(); // activity.uuid -> integer

/** Bumps once per attack roll, so a later damage roll only ever grabs its own attack's stash. */
function _bumpGeneration(activityUuid) {
  if (!activityUuid) return 0;
  const n = (_activityGeneration.get(activityUuid) ?? 0) + 1;
  _activityGeneration.set(activityUuid, n);
  return n;
}
function _currentGeneration(activityUuid) {
  return activityUuid ? (_activityGeneration.get(activityUuid) ?? 0) : 0;
}

/** Stash later children for one multipart group; FIFO batches avoid clobbering overlapping uses. */
function _stashAccept(useKey, parentId, pendingChildren) {
  if (!useKey || !pendingChildren?.length) return;
  let e = _pending.get(useKey);
  const existed = !!e;
  if (!e) { e = { ts: Date.now(), parents: new Map() }; _pending.set(useKey, e); }
  e.ts = Date.now();
  const queue = e.parents.get(parentId) ?? [];
  const queueDepthBefore = queue.length;
  // Timestamp each batch so old front entries can expire on their own.
  queue.push({ ts: Date.now(), children: pendingChildren });
  e.parents.set(parentId, queue);
  _debug("case-by-case | _stashAccept " + JSON.stringify({
    useKey, parentId, childCount: pendingChildren.length,
    reusedExistingEntry: existed, queueDepthBefore, queueDepthAfter: queue.length,
  }));
}

/** Consume stashed child formulas for one roll type, draining FIFO after dropping stale batches. */
function _stashConsume(useKey, rollType) {
  if (!useKey) return [];
  const e = _pending.get(useKey);
  if (!e) return [];
  if (Date.now() - e.ts > PENDING_TTL) { _pending.delete(useKey); return []; }
  const now = Date.now();
  const formulas = [];
  for (const [pid, queue] of e.parents) {
    let droppedStale = 0;
    while (queue.length && (now - queue[0].ts > PENDING_TTL)) { queue.shift(); droppedStale++; }
    if (droppedStale) _debug(`case-by-case | _stashConsume dropped ${droppedStale} stale batch(es) for parentId ${pid} (older than PENDING_TTL)`);
    if (!queue.length) { e.parents.delete(pid); continue; }
    const batch = queue[0];
    const remaining = [];
    for (const c of batch.children) {
      // Carry modType too, not just the formula.
      if (c.type === rollType) formulas.push({ bonus: c.bonus, modType: c.modType ?? "simple" });
      else remaining.push(c);
    }
    if (remaining.length) batch.children = remaining;
    else queue.shift();
    if (!queue.length) e.parents.delete(pid);
  }
  if (!e.parents.size) _pending.delete(useKey);
  // Stringify so copied logs still show the consumed values.
  _debug("case-by-case | _stashConsume " + JSON.stringify({ useKey, rollType, consumed: formulas, remainingParents: e.parents.size }));
  return formulas;
}

// Accepted foe-damage stash.

const _acceptedFoeDamage = new Map(); // useKey -> QUEUE of { ts, bonuses: [{ id, name, bonus, filters, stackTag }] }
const ACCEPTED_FOE_DAMAGE_TTL = 30000; // ms

/** Queue accepted foe-damage batches per use key (FIFO). */
function _stashAcceptedFoeDamage(useKey, bonuses) {
  if (!useKey || !bonuses?.length) return;
  const queue = _acceptedFoeDamage.get(useKey) ?? [];
  queue.push({ ts: Date.now(), bonuses });
  _acceptedFoeDamage.set(useKey, queue);
}

/** Consume accepted foe damage bonuses (oldest still-valid batch, FIFO). */
function _consumeAcceptedFoeDamage(useKey) {
  if (!useKey) return [];
  const queue = _acceptedFoeDamage.get(useKey);
  if (!queue?.length) return [];
  const now = Date.now();
  while (queue.length && (now - queue[0].ts > ACCEPTED_FOE_DAMAGE_TTL)) queue.shift();
  if (!queue.length) { _acceptedFoeDamage.delete(useKey); return []; }
  const batch = queue.shift();
  if (!queue.length) _acceptedFoeDamage.delete(useKey);
  return batch.bonuses;
}

// Registration

export function registerPatches() {
  const lw = globalThis.libWrapper;
  lw.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.rollSavingThrow", rollSavingThrow, "MIXED");
  lw.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.rollAbilityCheck", rollAbilityCheck, "MIXED");
  lw.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.rollSkill",        rollSkill,        "MIXED");
  lw.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.rollDeathSave",    rollDeathSave,    "MIXED");
  if (CONFIG.Actor.documentClass.prototype.rollHitDie) {
    lw.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.rollHitDie",     rollHitDie,       "MIXED");
  }
  if (CONFIG.Actor.documentClass.prototype.rollInitiativeDialog) {
    lw.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.rollInitiativeDialog", rollInitiativeDialog, "MIXED");
  }
  _registerD20RollPatch();
  // Push matching local bonuses into dnd5e data prep.
  for (const [type, model] of Object.entries(CONFIG.Actor?.dataModels ?? {})) {
    if (!model?.prototype?.prepareDerivedData) continue;
    try {
      lw.register(MODULE_ID, `CONFIG.Actor.dataModels.${type}.prototype.prepareDerivedData`, systemPrepareDerivedData, "WRAPPER");
    } catch (err) { console.error(`case-by-case | could not wrap ${type} prepareDerivedData:`, err); }
  }
}

// Bonus types with native sheet keys.
const NATIVE_TYPES = new Set(["save", "check", "skill", "attack", "damage", "saveDC", "initiative"]);
const ATTACK_MODES = ["mwak", "rwak", "msak", "rsak"];

// Roll kinds that can use advantage/disadvantage.
const ALL_ROLL_KINDS = ["save", "check", "skill", "attack", "death", "hitDie", "initiative"];
// Native advantage kinds.
const NATIVE_ADVANTAGE_KINDS = new Set(["save", "check", "skill", "initiative"]);

/** Get the roll kinds a bonus applies to. */
function _bonusRollKinds(b) {
  if (b.type === "advantage" || b.type === "disadvantage") {
    return b.filters?.rollKinds?.length ? b.filters.rollKinds : ALL_ROLL_KINDS;
  }
  return [b.type];
}

/** Stack tags shared by 2+ of this actor's own bonuses (including self auras), so a native-routed bonus can still be pulled into dedup instead of silently double-applying. */
function _actorCollidingStackTags(actor) {
  const counts = new Map();
  for (const source of _buildSources(actor)) {
    for (const b of peekBonuses(source)) {
      if (!b.enabled) continue;
      if (b.aura?.enabled && !b.aura?.self) continue;
      const tag = (b.stackTag ?? "").trim().toLowerCase();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const colliding = new Set();
  for (const [tag, n] of counts) if (n > 1) colliding.add(tag);
  return colliding;
}

/** Check whether a bonus can use a native sheet key. */
function _isNativeSelfBonus(b, collidingTags = null) {
  if (!b?.enabled) return false;
  if (b.aura?.enabled) return false;
  if (b.optional) return false;
  if (b.kind === "multipart") return false;
  // Non-simple mod types stay on the roll-time path.
  if ((b.modType ?? "simple") !== "simple") return false;
  // Extra d20 dice also stay roll-time only.
  if (String(b.additionalD20 ?? "").trim() !== "" && String(b.additionalD20 ?? "").trim() !== "0") return false;
  // Native advantage only exists for save/check/skill.
  if ((b.advantage || b.disadvantage) && !["save", "check", "skill"].includes(b.type)) return false;
  if (!NATIVE_TYPES.has(b.type)) return false;
  // Spell Save DC only blocks on true roll-context or foe filters.
  if (b.type === "saveDC" ? _hasSaveDCBlockingFilters(b.filters) : _hasRollContextFilters(b.filters)) return false;
  // Item scoping stays roll-time.
  if (b.scopeToHostItem) return false;
  // Shared stack tags need the normal dedup pass.
  if (collidingTags?.has((b.stackTag ?? "").trim().toLowerCase())) return false;
  return true;
}

/** Check whether a bonus can use native advantage routing. */
function _isNativeAdvantageBonus(b) {
  return _bonusRollKinds(b).some(k => _nativeAdvantageRoutesKind(b, k));
}

/** Check whether one roll kind routes natively. */
function _nativeAdvantageRoutesKind(b, kind) {
  if (!b?.enabled) return false;
  if (b.aura?.enabled) return false;
  if (b.optional) return false;
  if (b.kind === "multipart") return false;
  if (_hasRollContextFilters(b.filters)) return false;
  if (b.scopeToHostItem) return false;
  return NATIVE_ADVANTAGE_KINDS.has(kind) && _bonusRollKinds(b).includes(kind);
}

/** Check for roll-context filters. */
function _hasRollContextFilters(f = {}) {
  return !!(f.itemTypes?.length || f.weaponProps?.length || f.spellSchools?.length
    || f.spellComponents?.length || f.damageTypes?.length
    || f.minSpellLevel != null || f.maxSpellLevel != null
    || f.comparison?.trim()
    // Proficiency only makes sense once a specific ability or skill is known.
    || f.proficiency?.trim()
    // hp.max can be derived too.
    || f.targetBloodied != null
    // Effect state is live.
    || f.targetEffectName?.trim()
    // The rest of these fields are also live actor state, so keep them roll-time.
    || f.minSlots != null || f.maxSlots != null
    || f.targetMovement?.length || f.targetTypes?.length || f.targetSizes?.length
    || f.targetConditions?.length || f.targetLanguages?.length
    // Foe filters are always roll-time.
    || f.foeConditions?.length || f.foeTypes?.length || f.foeSizes?.length
    || f.foeMovement?.length || f.foeLanguages?.length
    || f.foeWithin != null || f.foeBloodied != null || f.foeEffectName?.trim());
}

/** Spell Save DC can use native routing with self-state filters, but not roll-context or foe filters. */
function _hasSaveDCBlockingFilters(f = {}) {
  return !!(f.itemTypes?.length || f.weaponProps?.length || f.spellSchools?.length
    || f.spellComponents?.length || f.damageTypes?.length
    || f.minSpellLevel != null || f.maxSpellLevel != null
    || f.comparison?.trim() || f.proficiency?.trim()
    || f.foeConditions?.length || f.foeTypes?.length || f.foeSizes?.length
    || f.foeMovement?.length || f.foeLanguages?.length
    || f.foeWithin != null || f.foeBloodied != null || f.foeEffectName?.trim());
}

/** Native self bonus keys. */
function _nativeKeys(b) {
  const f = b.filters ?? {};
  switch (b.type) {
    case "saveDC": return ["bonuses.spell.dc"];
    case "save":   return f.abilities?.length
      ? f.abilities.map(a => `abilities.${a}.bonuses.save`)  : ["bonuses.abilities.save"];
    case "check":  return f.abilities?.length
      ? f.abilities.map(a => `abilities.${a}.bonuses.check`) : ["bonuses.abilities.check"];
    case "skill":  return f.skills?.length
      ? f.skills.map(s => `skills.${s}.bonuses.check`)       : ["bonuses.abilities.skill"];
    case "attack": return (f.attackModes?.length ? f.attackModes : ATTACK_MODES).map(m => `bonuses.${m}.attack`);
    case "damage": return (f.attackModes?.length ? f.attackModes : ATTACK_MODES).map(m => `bonuses.${m}.damage`);
    case "initiative": return ["attributes.init.bonus"];
    default:       return [];
  }
}

/** Append to a native bonus key. */
function _appendBonusKey(system, key, formula) {
  const cur = foundry.utils.getProperty(system, key);
  const curStr = cur ? String(cur).trim() : "";
  foundry.utils.setProperty(system, key, curStr ? `${curStr} + ${formula}` : formula);
}

/** Native roll.mode keys for advantage/disadvantage. */
function _nativeAdvantageKeys(b) {
  const f = b.filters ?? {};
  const allAbilities = Object.keys(CONFIG.DND5E?.abilities ?? {});
  const allSkills = Object.keys(CONFIG.DND5E?.skills ?? {});
  const keys = [];
  for (const kind of _bonusRollKinds(b)) {
    if (kind === "save") keys.push(...(f.abilities?.length ? f.abilities : allAbilities)
      .map(a => `abilities.${a}.save.roll.mode`));
    else if (kind === "check") keys.push(...(f.abilities?.length ? f.abilities : allAbilities)
      .map(a => `abilities.${a}.check.roll.mode`));
    else if (kind === "skill") keys.push(...(f.skills?.length ? f.skills : allSkills)
      .map(s => `skills.${s}.roll.mode`));
    else if (kind === "initiative") keys.push("attributes.init.roll.mode");
    // attack/death/hitDie: no native field, intentionally not collected here.
  }
  return keys;
}

/** Apply advantage/disadvantage contributions per key. */
function _applyAdvantageModeContribs(system, contribs) {
  for (const [key, { adv, dis }] of contribs) {
    if (adv) _grantAdvantageModeSource(system, key, 1);
    if (dis) _grantAdvantageModeSource(system, key, -1);
  }
}

/** Register one advantage/disadvantage source on a native mode field, using applyChange when available. */
function _grantAdvantageModeSource(system, key, delta) {
  try {
    const field = system.schema?.getField?.(key);
    if (typeof field?.applyChange !== "function") {
      const ADV_MODE = CONFIG.Dice.D20Roll.ADV_MODE;
      const current = Number(foundry.utils.getProperty(system, key)) || ADV_MODE.NORMAL;
      const sawAdvantage = delta === 1 || current === ADV_MODE.ADVANTAGE;
      const sawDisadvantage = delta === -1 || current === ADV_MODE.DISADVANTAGE;
      const combined = (sawAdvantage && sawDisadvantage) ? ADV_MODE.NORMAL
        : sawAdvantage ? ADV_MODE.ADVANTAGE : sawDisadvantage ? ADV_MODE.DISADVANTAGE : current;
      foundry.utils.setProperty(system, key, combined);
      return;
    }
    const current = foundry.utils.getProperty(system, key);
    const change = { key, value: delta, mode: CONST.ACTIVE_EFFECT_MODES.ADD };
    const final = field.applyChange(current, system, change);
    foundry.utils.setProperty(system, key, final);
  } catch (err) {
    console.error(`case-by-case | granting native advantage mode source for "${key}" failed:`, err);
  }
}

/** Write matching self bonuses into dnd5e's native data keys. */
function systemPrepareDerivedData(wrapped, ...args) {
  try { _injectActorBonuses(this.parent, this); }
  catch (err) { console.error("case-by-case | self bonus injection failed:", err); }
  return wrapped(...args);
}

function _injectActorBonuses(actor, system) {
  if (!actor || !system?.bonuses) return;
  // Accumulate advantage/disadvantage before writing any fields.
  const advModeContribs = new Map();
  const collidingTags = _actorCollidingStackTags(actor);

  for (const source of _buildSources(actor)) {
    for (const b of peekBonuses(source)) {
      // Formula routing and advantage routing are separate now.
      const nativeFormula = _isNativeSelfBonus(b, collidingTags);
      const nativeAdvantage = _isNativeAdvantageBonus(b) && (b.advantage !== b.disadvantage);
      if (!nativeFormula && !nativeAdvantage) continue;
      // Only actor-state filters apply here.
      if (!_filtersMatch(b, {}, actor)) continue;

      if (nativeFormula) {
        const formula = String(b.bonus ?? "").trim();
        if (formula) {
          for (const key of _nativeKeys(b)) _appendBonusKey(system, key, formula);
        }
      }

      // Skip impossible double-flag bonuses.
      if (nativeAdvantage) {
        const isAdvantage = !!b.advantage;
        const keys = _nativeAdvantageKeys(b);
        for (const key of keys) {
          let entry = advModeContribs.get(key);
          if (!entry) { entry = { adv: false, dis: false }; advModeContribs.set(key, entry); }
          if (isAdvantage) entry.adv = true; else entry.dis = true;
        }
        _debug("case-by-case | native advantage routed at prep time", {
          bonus: b.name, type: b.type, mode: isAdvantage ? "advantage" : "disadvantage", keys,
          alsoHasExtraD20: String(b.additionalD20 ?? "").trim() !== "" && String(b.additionalD20 ?? "").trim() !== "0",
        });
      }
    }
  }

  _applyAdvantageModeContribs(system, advModeContribs);
}

/**
 * Recompute case-by-case advantage/disadvantage for one roll kind.
 * @param {object} [rollContext] Pass the real ability/skill so filtered bonuses stay accurate.
 */
function _cbOwnAdvantageMode(actor, rollingToken, rollKind, rollContext = {}) {
  let adv = false, dis = false;
  for (const source of _buildSources(actor)) {
    for (const bonus of peekBonuses(source)) {
      if (!bonus.enabled || bonus.aura?.enabled) continue;
      // Optional bonuses are handled by the normal prompt flow, not this render-time backstop.
      if (bonus.optional) continue;
      if (!(bonus.advantage || bonus.disadvantage)) continue;
      if (!_bonusRollKinds(bonus).includes(rollKind)) continue;
      if (!_filtersMatch(bonus, rollContext, actor, rollKind)) continue;
      if (bonus.advantage) adv = true;
      if (bonus.disadvantage) dis = true;
    }
  }
  if (rollingToken) {
    for (const { token: sourceToken, auras } of getAuraSources()) {
      for (const bonus of auras) {
        if (bonus.optional) continue;
        if (!(bonus.advantage || bonus.disadvantage)) continue;
        if (!_bonusRollKinds(bonus).includes(rollKind)) continue;
        if (!isInAura(sourceToken, rollingToken, bonus.aura)) continue;
        if (!_filtersMatch(bonus, rollContext, actor, rollKind)) continue;
        if (bonus.advantage) adv = true;
        if (bonus.disadvantage) dis = true;
      }
    }
  }
  return { adv, dis };
}

/** AC5E backstop: reassert mode at dialog render time. */
function _rollKindFromHookNames(hookNames = []) {
  const lower = (hookNames ?? []).map(h => String(h).toLowerCase());
  // More specific checks first.
  if (lower.includes("skill")) return "skill";
  if (lower.includes("initiativedialog")) return "initiative";
  if (lower.includes("savingthrow")) return "save";
  if (lower.includes("deathsave")) return "death";
  if (lower.includes("hitdie")) return "hitDie";
  if (lower.includes("abilitycheck")) return "check";
  return null;
}

/** Reapply case-by-case mode to a roll or config. */
function _reassertAdvantageMode(target, actor, rollKind, rollContext = {}) {
  if (!target || !actor || !rollKind) return false;
  try {
    const rollingToken = _preferredToken(actor);
    const { adv, dis } = _cbOwnAdvantageMode(actor, rollingToken, rollKind, rollContext);
    if (!adv && !dis) return false; // case-by-case has nothing to say about this roll — leave alone

    const ADV_MODE = CONFIG.Dice.D20Roll.ADV_MODE;
    target.options ??= {};
    const before = target.options.advantageMode;
    const curAdv = !!(target.options.advantage || before === ADV_MODE.ADVANTAGE);
    const curDis = !!(target.options.disadvantage || before === ADV_MODE.DISADVANTAGE);
    const finalAdv = adv || curAdv;
    const finalDis = dis || curDis;
    const mode = (finalAdv && finalDis) ? ADV_MODE.NORMAL
      : finalAdv ? ADV_MODE.ADVANTAGE : finalDis ? ADV_MODE.DISADVANTAGE : ADV_MODE.NORMAL;
    target.options.advantage = finalAdv && !finalDis;
    target.options.disadvantage = finalDis && !finalAdv;
    target.options.advantageMode = mode;
    const changed = mode !== before;
    if (changed) {
      _debug("case-by-case | reasserted advantage mode", {
        rollKind, cbAdv: adv, cbDis: dis, before, after: mode,
      });
    }
    return changed;
  } catch (err) {
    console.error("case-by-case | reasserting advantage mode failed:", err);
    return false;
  }
}

/** Re-run modifier config after a mode fix. */
function _reassertAdvantageModeOnRolls(app, rolls) {
  try {
    const rollKind = _rollKindFromHookNames(app?.config?.hookNames);
    if (!rollKind) return false;
    const actor = app?.config?.subject?.actor ?? app?.config?.subject;
    if (!actor) return false;
    // Pass the real ability or skill so filtered bonuses stay accurate.
    const rollContext = { ability: app?.config?.ability, skill: app?.config?.skill };
    let changed = false;
    for (const roll of rolls) {
      if (!_reassertAdvantageMode(roll, actor, rollKind, rollContext)) continue;
      changed = true;
      try { roll.configureModifiers(); }
      catch (err) { console.error("case-by-case | re-configuring roll after advantage reassert failed:", err); }
    }
    return changed;
  } catch (err) {
    console.error("case-by-case | reasserting advantage mode on render failed:", err);
    return false;
  }
}

/** Register the roll hooks. */
export function registerRollHooks() {
  _registerD20RollPatch();
  _registerDiceModPatch();
  // Required attack/damage bonuses inject here.
  Hooks.on("dnd5e.preRollAttack", (rollConfig, dialog, message) => _injectSync(rollConfig, "attack", dialog, message));
  // Heal/temp HP share the damage hook.
  Hooks.on("dnd5e.preRollDamage", (rollConfig, dialog, message) =>
    _injectSync(rollConfig, _activityBonusType(rollConfig.subject), dialog, message));
  Hooks.on("dnd5e.preConfigureInitiative", (actor, rollConfig) => _configureInitiative(actor, rollConfig));
  // Listen on both preRoll hooks; V2 fires last.
  Hooks.on("dnd5e.preRoll", (config, dialog) => _finalizeDialogDefaultButton("dnd5e.preRoll", config, dialog));
  Hooks.on("dnd5e.preRollV2", (config, dialog) => _finalizeDialogDefaultButton("dnd5e.preRollV2", config, dialog));

  // Final render-time backstop.
  Hooks.on("renderD20RollConfigurationDialog", (app, html) => _forceDialogDefaultButtonFocus(app, html));

  if (game.modules.get("midi-qol")?.active) {
    Hooks.on("midi-qol.preAttackRoll", (workflow) => _configureMidiAttackRoll(workflow));
    Hooks.on("midi-qol.preAttackRollConfig", (workflow) => _configureMidiAttackRollConfig(workflow));
    // No RollComplete stash wipe; FIFO + TTL is safer for overlapping uses.

    // These fire from inside Item.use(), before our own rollAttack wrapper ever runs, so the
    // cache is ready in time.
    Hooks.on("midi-qol.preTargetingV2", ({ workflow } = {}) => _cacheLiveWorkflow(workflow));
    Hooks.on("midi-qol.preItemRollV2", ({ workflow } = {}) => _cacheLiveWorkflow(workflow));
  }
}

// Live workflow cache, replaces polling midi's own getWorkflowByActivityUuid which is dead in practice.
const _liveWorkflowByActivity = new Map(); // activity.uuid -> live midi-qol Workflow object
const _workflowTags = new WeakMap();        // Workflow object -> our own stable tag

function _cacheLiveWorkflow(workflow) {
  const activityUuid = workflow?.activity?.uuid;
  if (!activityUuid) return;
  _liveWorkflowByActivity.set(activityUuid, workflow);
}

/** Stable tag for a live workflow object, independent of midi-qol's own mutable workflow.id. */
function _tagForWorkflow(workflow) {
  if (!workflow) return null;
  let tag = _workflowTags.get(workflow);
  if (!tag) { tag = foundry.utils.randomID(); _workflowTags.set(workflow, tag); }
  return tag;
}

function _configureMidiAttackRoll(workflow) {
  const actor = workflow?.actor;
  const activity = workflow?.activity;
  const token = workflow?.token ?? _preferredToken(actor);
  if (!actor || !activity || !token) {
    _debug("case-by-case | _configureMidiAttackRoll: bailing, missing actor/activity/token", {
      hasActor: !!actor, hasActivity: !!activity, hasToken: !!token,
    });
    return;
  }

  const config = { item: activity.item, subject: activity, activity };
  const targets = workflow.targets ?? new Set();

  const local = _gatherBonusData(actor, token, config, "attack", targets, token)
    .filter(b => !b.optional)
    .filter(_hasD20Control);

  const foe = [
    ..._gatherFoeBonuses(actor, config, ["attack"]),
    ..._gatherAuraFoeBonuses(actor, token, config, ["attack"]),
  ].filter(b => [...targets].some(t => _foeMatches(t, b.filters, token)))
   .filter(_hasD20Control)
   .map(b => ({
     id: b.id,
     name: b.name,
     formula: b.bonus ?? "0",
     stackTag: b.stackTag ?? "",
     advantage: !!b.advantage,
     disadvantage: !!b.disadvantage,
     additionalD20: b.additionalD20 ?? "0",
   }));

  const bonuses = _deduplicateByTag([...local, ...foe]);
  _debug("case-by-case | _configureMidiAttackRoll: gathered D20-control bonuses", {
    workflowId: workflow?.id, localCount: local.length, foeCount: foe.length,
    bonuses: bonuses.map(b => ({ id: b.id, name: b.name, advantage: b.advantage, disadvantage: b.disadvantage, additionalD20: b.additionalD20 })),
  });
  if (!bonuses.length) return;

  const opts = {
    advantageMode: workflow?.workflowOptions?.advantage ? CONFIG.Dice.D20Roll.ADV_MODE.ADVANTAGE
      : (workflow?.workflowOptions?.disadvantage ? CONFIG.Dice.D20Roll.ADV_MODE.DISADVANTAGE : CONFIG.Dice.D20Roll.ADV_MODE.NORMAL),
    advantage: !!workflow?.workflowOptions?.advantage,
    disadvantage: !!workflow?.workflowOptions?.disadvantage,
  };
  _applyD20BonusesToOptions(opts, bonuses, actor);

  // Stash raw pool totals; mode can change later.
  workflow.cbD20 ??= {};
  workflow.cbD20.attackMode = opts.advantageMode;
  workflow.cbD20.advPoolTotal = Number(opts._cbAdvPoolTotal) || 0;
  workflow.cbD20.disPoolTotal = Number(opts._cbDisPoolTotal) || 0;
  workflow.cbD20.unconditionalPoolTotal = Number(opts._cbUnconditionalPoolTotal) || 0;
  _debug("case-by-case | _configureMidiAttackRoll: computed", {
    workflowId: workflow?.id, attackMode: workflow.cbD20.attackMode,
    advPoolTotal: workflow.cbD20.advPoolTotal, disPoolTotal: workflow.cbD20.disPoolTotal,
    unconditionalPoolTotal: workflow.cbD20.unconditionalPoolTotal,
  });
}

function _hasD20Control(b) {
  return !!(b.advantage || b.disadvantage || (String(b.additionalD20 ?? "").trim() !== "" && String(b.additionalD20 ?? "").trim() !== "0"));
}

function _configureMidiAttackRollConfig(workflow) {
  const ADV_MODE = CONFIG.Dice.D20Roll.ADV_MODE;
  const mode = workflow?.cbD20?.attackMode;
  const advPoolTotal = Number(workflow?.cbD20?.advPoolTotal) || 0;
  const disPoolTotal = Number(workflow?.cbD20?.disPoolTotal) || 0;
  const unconditionalPoolTotal = Number(workflow?.cbD20?.unconditionalPoolTotal) || 0;
  _debug("case-by-case | _configureMidiAttackRollConfig: fired", {
    workflowId: workflow?.id, mode, advPoolTotal, disPoolTotal, unconditionalPoolTotal,
    hasCbD20: !!workflow?.cbD20, hasTracker: !!workflow?.attackRollModifierTracker,
  });
  if (mode == null && !advPoolTotal && !disPoolTotal && !unconditionalPoolTotal) return;

  const tracker = workflow.attackRollModifierTracker;
  if (tracker) {
    if (mode === ADV_MODE.ADVANTAGE) tracker.advantage.add("case-by-case", "Case by Case");
    else if (mode === ADV_MODE.DISADVANTAGE) tracker.disadvantage.add("case-by-case", "Case by Case");
  }

  workflow.rollOptions ??= {};
  workflow.workflowOptions ??= {};

  // Back-compat flat total.
  let modePool = 0;
  if (mode === ADV_MODE.ADVANTAGE) modePool = advPoolTotal;
  else if (mode === ADV_MODE.DISADVANTAGE) modePool = disPoolTotal;
  const eagerExtra = Math.max(0, Math.min(MAX_EXTRA_D20, unconditionalPoolTotal + modePool));
  if (eagerExtra > 0) {
    workflow.rollOptions.cbExtraD20 = eagerExtra;
    workflow.workflowOptions.cbExtraD20 = eagerExtra;
    _debug("case-by-case | midi preAttackRollConfig extra applied to workflow", { workflowId: workflow?.id, mode, eagerExtra });
  } else {
    delete workflow.rollOptions.cbExtraD20;
    delete workflow.workflowOptions.cbExtraD20;
  }

  // Keep the raw pool totals too.
  const setOrDelete = (key, val) => {
    if (val > 0) { workflow.rollOptions[key] = val; workflow.workflowOptions[key] = val; }
    else { delete workflow.rollOptions[key]; delete workflow.workflowOptions[key]; }
  };
  setOrDelete("_cbAdvPoolTotal", advPoolTotal);
  setOrDelete("_cbDisPoolTotal", disPoolTotal);
  setOrDelete("_cbUnconditionalPoolTotal", unconditionalPoolTotal);
}

function _registerD20RollPatch() {
  if (!globalThis.libWrapper) return;

  // Wrap configureModifiers instead of a missing method.
  if (!_d20PatchRegistered && CONFIG.Dice?.D20Roll?.prototype?.configureModifiers) {
    try {
      globalThis.libWrapper.register(MODULE_ID, "CONFIG.Dice.D20Roll.prototype.configureModifiers", d20ConfigureModifiers, "WRAPPER");
      _d20PatchRegistered = true;
    } catch (err) {
      console.error("case-by-case | could not wrap D20Roll configureModifiers:", err);
    }
  }

  if (!_d20FromConfigPatchRegistered && CONFIG.Dice?.D20Roll?.fromConfig) {
    try {
      globalThis.libWrapper.register(MODULE_ID, "CONFIG.Dice.D20Roll.fromConfig", d20FromConfig, "WRAPPER");
      _d20FromConfigPatchRegistered = true;
    } catch (err) {
      console.error("case-by-case | could not wrap D20Roll.fromConfig:", err);
    }
  }
}

/** Wrap base Roll evaluate methods to apply dice mods once. */
function _registerDiceModPatch() {
  if (!globalThis.libWrapper || _diceModPatchRegistered) return;
  const wrapper = function (wrapped, ...args) {
    try { _applyCbDiceMods(this); }
    catch (err) { console.error("case-by-case | applying dice modifiers failed:", err); }
    return wrapped(...args);
  };
  let any = false;
  if (typeof Roll?.prototype?.evaluate === "function") {
    try { globalThis.libWrapper.register(MODULE_ID, "Roll.prototype.evaluate", wrapper, "WRAPPER"); any = true; }
    catch (err) { console.error("case-by-case | could not wrap Roll.prototype.evaluate:", err); }
  }
  if (typeof Roll?.prototype?.evaluateSync === "function") {
    try { globalThis.libWrapper.register(MODULE_ID, "Roll.prototype.evaluateSync", wrapper, "WRAPPER"); any = true; }
    catch (err) { console.error("case-by-case | could not wrap Roll.prototype.evaluateSync:", err); }
  }
  if (any) _diceModPatchRegistered = true;
}

/** Apply stashed dice mods to each Die term before evaluation. */
function _applyCbDiceMods(roll) {
  const mods = roll?.options?.cbDiceMods;
  if (!mods?.length || roll._evaluated) return;
  const DieCls = foundry.dice?.terms?.Die ?? globalThis.Die;
  if (!DieCls) return;
  // Build the debug snapshot only when logging is on.
  const debugOn = _debugOn();
  const snapshotTerms = () => (roll.terms ?? []).map(t => ({
    class: t?.constructor?.name, faces: t?.faces, number: t?.number,
    modifiers: t?.modifiers ? [...t.modifiers] : null,
  }));
  if (debugOn) _debug("case-by-case | _applyCbDiceMods: applying", { mods, formulaBefore: roll.formula, terms: snapshotTerms() });
  for (const term of roll.terms ?? []) {
    if (!(term instanceof DieCls)) continue; // Only dice terms can be modified.
    for (const mod of mods) _applyOneDiceMod(term, mod);
  }
  if (debugOn) _debug("case-by-case | _applyCbDiceMods: applied", { formulaAfter: roll.formula, terms: snapshotTerms() });
}

/** Apply one dice-mod setting to one Die term. */
function _applyOneDiceMod(term, mod) {
  const raw = Number(mod?.value);
  const n = Number.isFinite(raw) ? Math.trunc(raw) : null;
  switch (mod?.modType) {
    case "reroll": // Reroll once on values at or below n.
      term.modifiers.unshift(`r<=${n ?? 1}`);
      break;
    case "minDie": // Clamp low rolls up to n.
      term.modifiers.unshift(`min${n ?? 1}`);
      break;
    case "maxDie": // Clamp high rolls down to n; invalid or non-positive values fall back to the die size.
      term.modifiers.unshift(`max${(n && n > 0) ? n : term.faces}`);
      break;
    case "explode": // Blank values use the die max; computed zero/negative values do nothing.
      if (n === null) term.modifiers.unshift("x");
      else if (n > 0) term.modifiers.unshift(`x>=${n}`);
      break;
    case "resize": { // Step along DIE_SIZE_PROGRESSION, clamping at each end.
      if (n) {
        let idx = DIE_SIZE_PROGRESSION.indexOf(term.faces);
        if (idx === -1) idx = DIE_SIZE_PROGRESSION.findIndex(f => f >= term.faces);
        if (idx === -1) idx = DIE_SIZE_PROGRESSION.length - 1;
        const newIdx = Math.max(0, Math.min(DIE_SIZE_PROGRESSION.length - 1, idx + n));
        term.faces = DIE_SIZE_PROGRESSION[newIdx];
      }
      break;
    }
    default:
      break; // "simple" and unknown values should not reach this path.
  }
}

function d20FromConfig(wrapped, config, process, ...args) {
  config ??= {};
  config.options ??= {};

  const extraRaw = config.options.cbExtraD20
    ?? config.cbExtraD20
    ?? process?.cbExtraD20
    ?? process?.workflowOptions?.cbExtraD20
    ?? process?.midiOptions?.cbExtraD20;
  const extra = Math.max(0, Math.min(MAX_EXTRA_D20, Number(extraRaw) || 0));
  if (extra > 0) config.options.cbExtraD20 = extra;

  // Bridge the per-pool totals too.
  const advPoolRaw = config.options._cbAdvPoolTotal ?? process?.workflowOptions?._cbAdvPoolTotal ?? process?.midiOptions?._cbAdvPoolTotal;
  const disPoolRaw = config.options._cbDisPoolTotal ?? process?.workflowOptions?._cbDisPoolTotal ?? process?.midiOptions?._cbDisPoolTotal;
  const unconditionalPoolRaw = config.options._cbUnconditionalPoolTotal ?? process?.workflowOptions?._cbUnconditionalPoolTotal ?? process?.midiOptions?._cbUnconditionalPoolTotal;
  const advPool = Number(advPoolRaw) || 0;
  const disPool = Number(disPoolRaw) || 0;
  const unconditionalPool = Number(unconditionalPoolRaw) || 0;

  // Log the d20 config shape for debugging.
  _debug("case-by-case | d20FromConfig", {
    extraRaw, extra,
    configOptionsKeys: Object.keys(config.options ?? {}),
    processKeys: Object.keys(process ?? {}),
    processWorkflowOptions: process?.workflowOptions,
    processMidiOptions: process?.midiOptions,
    advantageMode: config.options?.advantageMode,
    advantage: config.options?.advantage,
    disadvantage: config.options?.disadvantage,
    elvenAccuracy: config.options?.elvenAccuracy,
  });

  const roll = wrapped(config, process, ...args);
  if (extra > 0 && roll) roll.cbExtraD20 = extra;
  if (roll) {
    if (advPool) roll._cbAdvPoolTotal = advPool;
    if (disPool) roll._cbDisPoolTotal = disPool;
    if (unconditionalPool) roll._cbUnconditionalPoolTotal = unconditionalPool;
  }
  return roll;
}

/** Wrap activity attack/damage rolls for optional prompts. */
export function registerActivityPatches() {
  const lw = globalThis.libWrapper;
  const types = CONFIG.DND5E?.activityTypes ?? {};
  for (const [key, cfg] of Object.entries(types)) {
    const cls = cfg?.documentClass;
    if (!cls?.prototype) continue;
    if (typeof cls.prototype.rollAttack === "function") {
      try {
        lw.register(MODULE_ID, `CONFIG.DND5E.activityTypes.${key}.documentClass.prototype.rollAttack`, activityRollAttack, "MIXED");
      } catch (err) { console.error(`case-by-case | could not wrap rollAttack for "${key}":`, err); }
    }
    if (typeof cls.prototype.rollDamage === "function") {
      try {
        lw.register(MODULE_ID, `CONFIG.DND5E.activityTypes.${key}.documentClass.prototype.rollDamage`, activityRollDamage, "MIXED");
      } catch (err) { console.error(`case-by-case | could not wrap rollDamage for "${key}":`, err); }
    }
  }

  // Spell Save DC bonuses are local-only now (aura projection for them was removed), routed at prep time instead.
}

// ---------------------------------------------------------------------------
// Activity wrappers (async — optional attack/damage bonuses). `this` = Activity.
// ---------------------------------------------------------------------------

async function activityRollAttack(wrapped, config = {}, dialog = {}, message = {}) {
  return _handleActivityOptional.call(this, wrapped, [config, dialog, message], config, "attack", "dnd5e.preRollAttack");
}
async function activityRollDamage(wrapped, config = {}, dialog = {}, message = {}) {
  // Same activity-specific roll type logic as above.
  return _handleActivityOptional.call(this, wrapped, [config, dialog, message], config, _activityBonusType(this), "dnd5e.preRollDamage");
}

async function _handleActivityOptional(wrapped, args, config, rollType, hookName) {
  const activity = this;
  const actor = activity?.item?.actor ?? activity?.actor ?? null;
  if (!actor) return wrapped(...args);

  // args is [config, dialog, message]; message may carry originatingMessage.
  const message = args[2];
  // Bump the generation on a fresh attack roll only, so a damage roll only ever reads its own.
  if (rollType === "attack") _bumpGeneration(activity?.uuid);
  const rollingToken = _preferredToken(actor);
  // Build the matcher config.
  const matchConfig = { ...config, subject: activity, item: activity.item };
  const useKey = _useKey(activity, { message });

  // Targets are already selected.
  const targets = _getRollTargets(activity, config);
  const attackerToken = rollingToken;

  // Simple optionals and timed children.
  const simpleOptional = _gatherBonusData(actor, rollingToken, matchConfig, rollType, targets, attackerToken)
    .filter(b => b.optional);

  // Gather foe-filtered optionals separately.
  const foeOptional = [
    ..._gatherFoeBonuses(actor, matchConfig, [rollType], true),
    ..._gatherAuraFoeBonuses(actor, rollingToken, matchConfig, [rollType], true),
  ]
    .filter(b => targets.size && [...targets].some(t => _foeMatches(t, b.filters, attackerToken)))
    // Keep bonus/filter data for the foe-damage path.
    .map(b => ({
      id: b.id,
      name: b.name,
      formula: b.bonus,
      bonus: b.bonus,
      filters: b.filters,
      // modType used to get dropped here too, so accepting this always behaved as a flat bonus.
      modType: b.modType ?? "simple",
      stackTag: b.stackTag ?? "",
      advantage: !!b.advantage,
      disadvantage: !!b.disadvantage,
      additionalD20: b.additionalD20 ?? "0",
      foeFiltered: true,
      // Carry consumption through too.
      consumption: b.consumption,
    }));

  // Multipart groups (self + aura) whose single decision point is THIS roll.
  const groups = [
    ..._collectTimedGroups(actor, matchConfig, rollType, targets, attackerToken),
    ..._collectAuraTimedGroups(actor, rollingToken, matchConfig, rollType, targets, attackerToken),
  ];

  // Optional crit range uses the attack dialog.
  const criticalOptional = rollType === "attack" ? [
    ..._gatherBonusData(actor, rollingToken, matchConfig, "critRange", targets, attackerToken).filter(b => b.optional),
    ...[
      ..._gatherFoeBonuses(actor, matchConfig, ["critRange"], true),
      ..._gatherAuraFoeBonuses(actor, rollingToken, matchConfig, ["critRange"], true),
    ]
      .filter(b => targets.size && [...targets].some(t => _foeMatches(t, b.filters, attackerToken)))
      .map(b => ({ id: b.id, name: b.name, formula: b.bonus, foeFiltered: true })),
  ] : [];

  const allSimpleOptional = [...simpleOptional, ...foeOptional];
  if (!allSimpleOptional.length && !groups.length && !criticalOptional.length) return wrapped(...args);

  // Build one row per option.
  const rows = [
    ...allSimpleOptional.map(b => ({ id: b.id, name: b.name, formula: b.formula, kind: "simple", bonus: b, foeFiltered: !!b.foeFiltered })),
    ...groups.map(g => ({ id: g.id, name: g.label, formula: g.summary, kind: "group", group: g, foeFiltered: !!g.foeFiltered })),
    ...criticalOptional.map(b => ({ id: b.id, name: b.name, formula: `crit on ${b.formula}+`, kind: "critRange", bonus: b, foeFiltered: !!b.foeFiltered })),
  ];
  const chosen = await _promptOptional(rows, actor) ?? [];

  // Do not clear carry stash here; FIFO+TTL handles overlap and cleanup.

  const nowBonuses = [];
  // Foe damage/heal/temphp goes through the per-target stash.
  const foeDamageAccepted = [];
  // Substitute @consumed and spend the resource (shared logic, see _resolveChosenSimple).
  const chosenSimple = await _resolveChosenSimple(chosen, actor);
  for (const b of chosenSimple) {
    if (_isMultiTargetRollType(rollType) && b.foeFiltered) {
      // Keep modType for future foe-damage mod handling.
      foeDamageAccepted.push({ id: b.id, name: b.name, bonus: b.bonus, filters: b.filters,
                                modType: b.modType ?? "simple", stackTag: b.stackTag ?? "" });
    } else {
      nowBonuses.push(b);
    }
  }
  // Substitute the group's @consumed and spend its shared cost once (see _resolveChosenGroups).
  const chosenGroups = await _resolveChosenGroups(chosen, actor);
  for (const r of chosenGroups) {
    // Each part routes individually, so a group can mix foe-filtered and plain parts under one accept.
    r.group.nowChildren.forEach((c, i) => {
      if (_isMultiTargetRollType(rollType) && _hasFoeFilters(c.filters)) {
        // Same modType carry-through as the simple-bonus branch above (see its comment).
        foeDamageAccepted.push({ id: `${r.group.id}:${c.type}:${i}`, name: `${r.group.label}: ${c.name ?? c.type}`,
                                  bonus: c.bonus, filters: c.filters, modType: c.modType ?? "simple",
                                  stackTag: r.group.stackTag ?? "" });
      } else {
        nowBonuses.push({
          id: `${r.group.id}:now:${i}`,
          name: `${r.group.label}: ${c.name ?? c.type}`,
          formula: c.bonus,
          modType: c.modType ?? "simple",
          stackTag: r.group.stackTag ?? "",
          advantage: false,
          disadvantage: false,
          additionalD20: "0",
        });
      }
    });
    _stashAccept(useKey, r.group.id, r.group.laterChildren);   // apply later children at their rolls
  }
  if (foeDamageAccepted.length) _stashAcceptedFoeDamage(useKey, foeDamageAccepted);

  // Optional crit range takes the best threshold; spend cost and substitute @consumed first.
  let critThreshold = null;
  const chosenCritRange = await _resolveChosenCritRange(chosen, actor);
  if (chosenCritRange.length) {
    let min = Infinity;
    for (const b of chosenCritRange) {
      const v = _evalCritThreshold(b.formula, actor, b.name);
      if (Number.isFinite(v)) min = Math.min(min, v);
    }
    if (Number.isFinite(min)) critThreshold = Math.max(2, Math.min(20, min));
  }

  if (!nowBonuses.length && critThreshold === null) return wrapped(...args);

  // Cross-dedupe against required bonuses for this same roll before injecting (see _injectSync).
  if (nowBonuses.length) {
    const required = _gatherBonusData(actor, rollingToken, matchConfig, rollType).filter(b => !b.optional);
    const combined = _deduplicateByTag([...required, ...nowBonuses]);
    _pendingActivityBonuses.set(useKey, combined);
    _debug("case-by-case | _handleActivityOptional: stashed cross-deduped bonuses", {
      useKey, rollType,
      required: required.map(b => ({ name: b.name, formula: b.formula, stackTag: b.stackTag })),
      nowBonuses: nowBonuses.map(b => ({ name: b.name, formula: b.formula, stackTag: b.stackTag })),
      combined: combined.map(b => ({ name: b.name, formula: b.formula, stackTag: b.stackTag })),
    });
  }

  // Crit threshold is just a min clamp, so it's safe without the cross-dedup stash.
  const hookId = Number.isFinite(critThreshold) ? _injectOnce(hookName, [], activity, actor, critThreshold) : null;
  try { return await wrapped(...args); }
  finally {
    if (hookId != null) Hooks.off(hookName, hookId);
    _pendingActivityBonuses.delete(useKey);
  }
}

/** Whether one multipart child passes its own filters, plus the group's foe filters if given. */
function _childPasses(child, config, actor, targets, attackerToken, group = null) {
  if (!_filtersMatch({ filters: child.filters, type: child.type }, config, actor, child.type)) return false;
  const childFoe = _hasFoeFilters(child.filters);
  const groupFoe = !!group && _hasFoeFilters(group.filters);
  if (childFoe || groupFoe) {
    if (!targets?.size) return false;
    const ok = [...targets].some(t =>
      (!childFoe || _foeMatches(t, child.filters, attackerToken))
      && (!groupFoe || _foeMatches(t, group.filters, attackerToken)));
    if (!ok) return false;
  }
  return true;
}

/** Merge group foe filters into child filters for one-field consumers; child values win on collision. */
function _mergeFoeFilters(groupFilters = {}, childFilters = {}) {
  const FOE_KEYS = ["foeConditions", "foeTypes", "foeSizes", "foeMovement", "foeLanguages",
    "foeWithin", "foeBloodied", "foeEffectName", "foeEffectActiveOnly"];
  const out = { ...groupFilters, ...childFilters };
  for (const key of FOE_KEYS) {
    const v = childFilters?.[key];
    const childSet = Array.isArray(v) ? v.length > 0 : (v != null && v !== "");
    out[key] = childSet ? v : groupFilters?.[key];
  }
  return out;
}

/** Multipart groups whose accept/decline decision is made at this roll, split into now vs later children. */
function _collectTimedGroups(actor, config, rollType, targets = null, attackerToken = null) {
  const out = [];
  for (const source of _buildSources(actor)) {
    for (const b of peekBonuses(source)) {
      if (b.kind !== "multipart" || !b.enabled || !b.optional) continue;
      if (b.aura?.enabled) continue; // aura groups apply via the aura path, not a timed local prompt
      // Same hostItemOk idea as _gatherBonusData: a host-item-scoped group shouldn't offer on a different item.
      if (b.scopeToHostItem && !(source instanceof Item && _configItem(config)?.id === source.id)) continue;
      if ((b.promptTiming ?? "associated") !== rollType) continue;
      // Group-level Roll/Recipient filters gate the whole group; foe filters are handled per-child in _childPasses instead.
      if (!_filtersMatch(b, config, actor, rollType)) continue;
      // Each part also filters independently; the group is only offered if at least one part survives.
      const children = (b.children ?? []).filter(c => _childPasses(c, config, actor, targets, attackerToken, b));
      if (!children.length) continue;
      const isNow = (c) => c.type === rollType;
      out.push({
        id: b.id,
        label: b.name,
        summary: children.map(c => `${c.bonus} ${c.type}`).join(", "),
        nowChildren:   children.filter(isNow),
        laterChildren: children.filter(c => !isNow(c)),
        // "vs. target" dialog tag: true if ANY surviving part is foe-filtered.
        foeFiltered:   children.some(c => _hasFoeFilters(c.filters)),
        stackTag:      b.stackTag ?? "",
        // One shared cost for the whole group, spent once on accept (see _resolveChosenGroups).
        consumption:   b.consumption,
      });
    }
  }
  return out;
}

/** Like _collectTimedGroups but for optional timed multipart auras projected onto this recipient. */
function _collectAuraTimedGroups(actor, rollingToken, config, rollType, targets = null, attackerToken = null) {
  const out = [];
  if (!rollingToken) return out;
  const rollItem = _configItem(config);
  for (const { token: sourceToken, actor: sourceActor, auras } of getAuraSources()) {
    for (const b of auras) {
      if (b.kind !== "multipart" || !b.optional) continue;        // enabled + aura already guaranteed
      if ((b.promptTiming ?? "associated") !== rollType) continue;
      if (!isInAura(sourceToken, rollingToken, b.aura)) continue;
      // Group-level filters checked against the recipient, same as _collectTimedGroups.
      if (!_filtersMatch(b, config, actor, rollType)) continue;
      const children = (b.children ?? [])
        .map(c => ({
          type: c.type, name: c.name, modType: c.modType ?? "simple", filters: c.filters,
          bonus: _resolveFormula(c.bonus, sourceActor, rollItem) ?? c.bonus,
        }))
        .filter(c => _childPasses(c, config, actor, targets, attackerToken, b));
      if (!children.length) continue;
      const isNow = (c) => c.type === rollType;
      out.push({
        id: `${b.id}@${sourceToken.id}`,
        label: `${sourceActor.name}: ${b.name}`,
        summary: children.map(c => `${c.bonus} ${c.type}`).join(", "),
        nowChildren:   children.filter(isNow),
        laterChildren: children.filter(c => !isNow(c)),
        foeFiltered:   children.some(c => _hasFoeFilters(c.filters)),
        stackTag:      b.stackTag ?? "",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lib-wrapper stubs (async — supports optional dialog)
// ---------------------------------------------------------------------------

async function rollSavingThrow(wrapped, config = {}, dialog = {}, message = {}) {
  return _handleRoll.call(this, wrapped, [config, dialog, message], config, "save", "dnd5e.preRollSavingThrow");
}
async function rollAbilityCheck(wrapped, config = {}, dialog = {}, message = {}) {
  return _handleRoll.call(this, wrapped, [config, dialog, message], config, "check", "dnd5e.preRollAbilityCheck");
}
async function rollSkill(wrapped, config = {}, dialog = {}, message = {}) {
  return _handleRoll.call(this, wrapped, [config, dialog, message], config, "skill", "dnd5e.preRollSkill");
}
async function rollDeathSave(wrapped, config = {}, dialog = {}, message = {}) {
  return _handleRoll.call(this, wrapped, [config, dialog, message], config, "death", "dnd5e.preRollDeathSave");
}
async function rollHitDie(wrapped, config = {}, dialog = {}, message = {}) {
  return _handleRoll.call(this, wrapped, [config, dialog, message], config, "hitDie", "dnd5e.preRollHitDie");
}

async function rollInitiativeDialog(wrapped, rollOptions = {}) {
  const actor = this;
  const rollingToken = _preferredToken(actor);
  const allData = _gatherBonusData(actor, rollingToken, {}, "initiative");
  const required = allData.filter(b => !b.optional);
  const optional = allData.filter(b => b.optional);

  let chosen = [];
  if (optional.length) {
    // Wrap rows like _handleActivityOptional does, so the dialog shows cost/affordability correctly.
    const rows = optional.map(b => ({ id: b.id, name: b.name, formula: b.formula, kind: "simple", bonus: b }));
    const chosenRows = await _promptOptional(rows, actor) ?? [];
    chosen = await _resolveChosenSimple(chosenRows, actor);
  }

  const toInject = _deduplicateByTag([...required, ...chosen]);
  if (toInject.length) _pendingInitiativeChoices.set(actor.uuid, toInject);

  try {
    return await wrapped(rollOptions);
  } finally {
    // If no initiative config phase consumed these (cancel/abort), clear stale selections.
    _pendingInitiativeChoices.delete(actor.uuid);
  }
}

function d20ConfigureModifiers(wrapped, ...args) {
  const out = wrapped(...args);
  try { _applyCbExtraDice(this); }
  catch (err) { console.error("case-by-case | extra d20 dice failed:", err); }
  return out;
}

/** Apply extra d20 dice for both dnd5e pool shapes: numeric kh/kl pools and adv/dis token pools. */
function _applyCbExtraDice(roll) {
  const ADV_MODE = CONFIG.Dice?.D20Roll?.ADV_MODE;
  const options = roll.options ?? {};

  // Recompute from the roll's current resolved mode.
  let mode = options.advantageMode;
  if (mode == null && ADV_MODE) {
    if (options.advantage && !options.disadvantage) mode = ADV_MODE.ADVANTAGE;
    else if (!options.advantage && options.disadvantage) mode = ADV_MODE.DISADVANTAGE;
    else mode = ADV_MODE.NORMAL;
  }

  const unconditionalPool = Number(options._cbUnconditionalPoolTotal ?? roll._cbUnconditionalPoolTotal) || 0;
  const advPool = Number(options._cbAdvPoolTotal ?? roll._cbAdvPoolTotal) || 0;
  const disPool = Number(options._cbDisPoolTotal ?? roll._cbDisPoolTotal) || 0;
  let modePool = 0;
  if (ADV_MODE && mode === ADV_MODE.ADVANTAGE) modePool = advPool;
  else if (ADV_MODE && mode === ADV_MODE.DISADVANTAGE) modePool = disPool;
  const poolTotal = unconditionalPool + modePool;

  // Legacy midi path fallback.
  const legacyRaw = options.cbExtraD20
    ?? roll.cbExtraD20
    ?? options.workflowOptions?.cbExtraD20
    ?? options.midiOptions?.cbExtraD20;

  const extraRaw = poolTotal || legacyRaw;
  const extra = Math.max(0, Math.min(MAX_EXTRA_D20, Number(extraRaw) || 0));

  const die = roll.d20;
  _debug("case-by-case | configureModifiers: checking for extra d20 dice", {
    mode, unconditionalPool, advPool, disPool, legacyRaw, extraRaw, extra,
    hasDie: !!die, number: die?.number, modifiers: die?.modifiers ? [...die.modifiers] : null,
  });
  if (!extra || !die) return;

  // Newer dnd5e token pool.
  const tokenIdx = die.modifiers.findIndex(m => /^(adv|dis)\d*$/i.test(m));
  if (tokenIdx !== -1) {
    const before = die.modifiers[tokenIdx];
    // Idempotent by token value, not a sticky boolean.
    if (before === die.options?.cbAppliedToken) {
      _debug("case-by-case | configureModifiers: token pool already reflects our bump, skipping", { before });
      return;
    }
    const m = before.match(/^(adv|dis)(\d*)$/i);
    const token = m[1];
    const count = parseInt(m[2] || "1", 10);
    die.modifiers[tokenIdx] = `${token}${count + extra}`;
    die.options.cbAppliedToken = die.modifiers[tokenIdx];
    roll.resetFormula();
    _debug("case-by-case | extra d20 dice applied (adv-token pool)", {
      extra, before, after: die.modifiers[tokenIdx], formula: roll.formula,
    });
    return;
  }

  // Older dnd5e number-based pool.
  if (die.modifiers.some(m => m === "kh" || m === "kl")) {
    const before = die.number;
    // Same value-based idempotency for number pools.
    if (before === die.options?.cbAppliedNumber) {
      _debug("case-by-case | configureModifiers: number pool already reflects our bump, skipping", { before });
      return;
    }
    die.number = (Number(die.number) || 1) + extra;
    die.options.cbAppliedNumber = die.number;
    roll.resetFormula();
    _debug("case-by-case | extra d20 dice applied (number-based pool)", {
      extra, before, after: die.number, formula: roll.formula,
    });
    return;
  }

  _debug("case-by-case | configureModifiers: no adv/dis pool present, nothing to extend");
}

function _configureInitiative(actor, rollConfig) {
  const selected = _pendingInitiativeChoices.get(actor.uuid)
    ?? _gatherBonusData(actor, _preferredToken(actor), {}, "initiative").filter(b => !b.optional);
  _pendingInitiativeChoices.delete(actor.uuid);
  _applyBonusesToD20Config(rollConfig, _deduplicateByTag(selected), actor);
}

async function _handleRoll(wrapped, args, config, rollType, hookName) {
  const actor = this;
  const rollingToken = _preferredToken(actor);

  const allData = _gatherBonusData(actor, rollingToken, config, rollType);
  const required = allData.filter(b => !b.optional);
  const optional = allData.filter(b => b.optional);

  let chosen = [];
  if (optional.length) {
    // Wrap rows like _handleActivityOptional does, so the dialog shows cost/affordability correctly.
    const rows = optional.map(b => ({ id: b.id, name: b.name, formula: b.formula, kind: "simple", bonus: b }));
    const chosenRows = await _promptOptional(rows, actor) ?? [];
    chosen = await _resolveChosenSimple(chosenRows, actor);
  }

  const toInject = _deduplicateByTag([...required, ...chosen]);

  if (!toInject.length) return wrapped(...args);

  const hookId = _injectOnce(hookName, toInject, actor, actor);
  try { return await wrapped(...args); }
  finally { Hooks.off(hookName, hookId); }
}

/** One-shot pre-roll injector, skips firings for another subject; also applies crit threshold as a min clamp. */
function _injectOnce(hookName, bonuses, subject, actor = null, critThreshold = null) {
  let applied = false;
  const id = Hooks.on(hookName, (rollConfig, dialog) => {
    _logRollConfigShapeOnce(hookName, rollConfig, subject);
    if (applied) return;
    if (rollConfig?.subject != null && subject != null && rollConfig.subject !== subject) {
      // Not our pending roll; keep waiting.
      return;
    }
    applied = true;
    _applyBonusesToRollConfig(rollConfig, bonuses, actor);
    if (Number.isFinite(critThreshold)) {
      for (const r of rollConfig.rolls ?? []) {
        r.options ??= {};
        r.options.criticalSuccess = Math.min(Number(r.options.criticalSuccess ?? 20), critThreshold);
      }
    }
    _syncDialogDefaultButton(dialog, rollConfig, bonuses);
    Hooks.off(hookName, id);
  });
  return id;
}

function _applyBonusesToRollConfig(rollConfig, bonuses, actor) {
  // Non-simple mod types are handled via dice-mod stash.
  const additive = bonuses.filter(b => (b.modType ?? "simple") === "simple");
  const formulas = additive.map(b => String(b.formula ?? "").trim()).filter(Boolean).filter(f => f !== "0");
  if (formulas.length) {
    // Damage configs carry one roll per damage part. Add flat bonuses to the
    // first part only, or a multi-part weapon applies them once per part.
    const first = (rollConfig.rolls ?? [])[0];
    if (first) {
      first.parts ??= [];
      first.parts.push(...formulas);
    }
  }
  // Dice mods and d20 options still go on every roll: a reroll or min-die
  // should hit all damage parts, and attack/save configs only have one roll.
  for (const r of rollConfig.rolls ?? []) {
    _applyD20BonusesToRoll(r, bonuses, actor);
    _stashDiceMods(r.options ??= {}, bonuses, actor);
  }
}

function _applyBonusesToD20Config(rollConfig, bonuses, actor) {
  const additive = bonuses.filter(b => (b.modType ?? "simple") === "simple");
  const formulas = additive.map(b => String(b.formula ?? "").trim()).filter(Boolean).filter(f => f !== "0");
  if (formulas.length) {
    rollConfig.parts ??= [];
    rollConfig.parts.push(...formulas);
  }
  _applyD20BonusesToOptions(rollConfig.options ??= {}, bonuses, actor);
  _stashDiceMods(rollConfig.options, bonuses, actor);
}

/** Stash non-simple dice modifiers for evaluate-time term edits. */
function _stashDiceMods(options, bonuses, actor) {
  const mods = [];
  for (const b of bonuses) {
    const modType = b.modType ?? "simple";
    if (modType === "simple") continue;
    mods.push({ modType, value: _evalIntFormula(b.formula ?? "0", actor), name: b.name, id: b.id });
  }
  if (mods.length) {
    options.cbDiceMods = [...(options.cbDiceMods ?? []), ...mods];
    _debug("case-by-case | _stashDiceMods: stashed", {
      justAdded: mods,
      totalOnOptions: options.cbDiceMods,
    });
  }
}

function _applyD20BonusesToRoll(roll, bonuses, actor) {
  if (!roll) return;
  _applyD20BonusesToOptions(roll.options ??= {}, bonuses, actor);
  // Mirror pool totals onto roll-level fields too.
  const adv = Number(roll.options?._cbAdvPoolTotal) || 0;
  const dis = Number(roll.options?._cbDisPoolTotal) || 0;
  const unconditional = Number(roll.options?._cbUnconditionalPoolTotal) || 0;
  if (adv) roll._cbAdvPoolTotal = adv; else delete roll._cbAdvPoolTotal;
  if (dis) roll._cbDisPoolTotal = dis; else delete roll._cbDisPoolTotal;
  if (unconditional) roll._cbUnconditionalPoolTotal = unconditional; else delete roll._cbUnconditionalPoolTotal;
}

function _applyD20BonusesToOptions(options, bonuses, actor) {
  const ADV_MODE = CONFIG.Dice.D20Roll.ADV_MODE;
  const modeFromOptions = () => {
    if (options.advantageMode === ADV_MODE.ADVANTAGE) return ADV_MODE.ADVANTAGE;
    if (options.advantageMode === ADV_MODE.DISADVANTAGE) return ADV_MODE.DISADVANTAGE;
    if (options.advantage && !options.disadvantage) return ADV_MODE.ADVANTAGE;
    if (!options.advantage && options.disadvantage) return ADV_MODE.DISADVANTAGE;
    return ADV_MODE.NORMAL;
  };

  const hasModeControl = bonuses.some(b => !!b.advantage || !!b.disadvantage);
  let adv = modeFromOptions() === ADV_MODE.ADVANTAGE;
  let dis = modeFromOptions() === ADV_MODE.DISADVANTAGE;

  // Track extra dice per mode, not one blended total.
  let extraForAdvantage = 0;
  let extraForDisadvantage = 0;
  let extraUnconditional = 0;

  for (const b of bonuses) {
    if (hasModeControl) {
      if (b.advantage) adv = true;
      if (b.disadvantage) dis = true;
    }
    const amt = _evalIntFormula(b.additionalD20 ?? "0", actor);
    if (!amt) continue;
    if (b.type === "advantage") extraForAdvantage += amt;
    else if (b.type === "disadvantage") extraForDisadvantage += amt;
    else extraUnconditional += amt;
  }

  if (hasModeControl) {
    if (adv && dis) {
      options.advantageMode = ADV_MODE.NORMAL;
      options.advantage = false;
      options.disadvantage = false;
    } else {
      options.advantageMode = adv ? ADV_MODE.ADVANTAGE : (dis ? ADV_MODE.DISADVANTAGE : ADV_MODE.NORMAL);
      options.advantage = adv;
      options.disadvantage = dis;
    }
  }

  // Accumulate per-pool totals now; resolve bucket at configureModifiers time.
  options._cbAdvPoolTotal = (Number(options._cbAdvPoolTotal) || 0) + extraForAdvantage;
  options._cbDisPoolTotal = (Number(options._cbDisPoolTotal) || 0) + extraForDisadvantage;
  options._cbUnconditionalPoolTotal = (Number(options._cbUnconditionalPoolTotal) || 0) + extraUnconditional;
}

/** Sync dialog defaultButton from merged roll advantage mode. */
function _syncDialogDefaultButton(dialog, rollConfig, bonuses) {
  if (!dialog) {
    _debug("case-by-case | synced dialog defaultButton: NO DIALOG OBJECT, skipping");
    return;
  }
  if (!bonuses?.some(b => !!b.advantage || !!b.disadvantage)) return;

  const ADV_MODE = CONFIG.Dice.D20Roll.ADV_MODE;
  const mode = rollConfig?.rolls?.[0]?.options?.advantageMode;
  dialog.options ??= {};
  if (mode === ADV_MODE.ADVANTAGE) dialog.options.defaultButton = "advantage";
  else if (mode === ADV_MODE.DISADVANTAGE) dialog.options.defaultButton = "disadvantage";
  else dialog.options.defaultButton = "normal";
  _debug(`case-by-case | synced dialog defaultButton: mode=${mode} defaultButton=${dialog.options.defaultButton}`);
}

/** Final render-prep sync for defaultButton (last-writer backstop). */
function _finalizeDialogDefaultButton(hookName, config, dialog) {
  if (!dialog) {
    _debug(`case-by-case | finalize[${hookName}]: NO DIALOG OBJECT, skipping`);
    return;
  }
  const roll = config?.rolls?.[0];
  const ADV_MODE = CONFIG.Dice?.D20Roll?.ADV_MODE;
  if (!roll?.options || !ADV_MODE) {
    _debug(`case-by-case | finalize[${hookName}]: no roll/ADV_MODE, skipping`, {
      hasRoll: !!roll, hasOptions: !!roll?.options, hasAdvMode: !!ADV_MODE,
    });
    return;
  }

  let mode = roll.options.advantageMode;
  if (mode == null) {
    if (roll.options.advantage && !roll.options.disadvantage) mode = ADV_MODE.ADVANTAGE;
    else if (!roll.options.advantage && roll.options.disadvantage) mode = ADV_MODE.DISADVANTAGE;
    else mode = ADV_MODE.NORMAL;
  }

  dialog.options ??= {};
  const before = dialog.options.defaultButton;
  dialog.options.defaultButton = mode === ADV_MODE.ADVANTAGE ? "advantage"
    : mode === ADV_MODE.DISADVANTAGE ? "disadvantage" : "normal";
  // Keep logging every call while tracking override order.
  _debug(`case-by-case | finalize[${hookName}]: roll.options.advantageMode=${roll.options.advantageMode} `
    + `roll.options.advantage=${roll.options.advantage} roll.options.disadvantage=${roll.options.disadvantage} `
    + `computedMode=${mode} before=${before} after=${dialog.options.defaultButton}`);
}

/** Render-time backstop: reassert case-by-case's own mandatory advantage/disadvantage mode. */
function _forceDialogDefaultButtonFocus(app, html) {
  try {
    const rolls = app?.rolls ?? [];
    if (!rolls.length) return;

    // Respect manual mode clicks from the player.
    if (!app._cbManualOverrideListenerAttached) {
      app._cbManualOverrideListenerAttached = true;
      app.element?.addEventListener?.("click", (event) => {
        if (event.target.closest?.('button[data-action="advantage"], button[data-action="normal"], button[data-action="disadvantage"]')) {
          app._cbManualOverride = true;
        }
      });
    }
    if (app._cbManualOverride) return;

    // Only correct roll.options; AC5E button highlighting is left alone (cosmetic mismatch only).
    if (_reassertAdvantageModeOnRolls(app, rolls)) app.render({ parts: ["formulas", "buttons"] });
  } catch (err) {
    console.error("case-by-case | render backstop failed:", err);
  }
}

/** Resolve and evaluate a crit-threshold formula. */
function _evalCritThreshold(formula, actor, bonusName) {
  const s = String(formula ?? "").trim();
  if (!s) return NaN;
  const resolved = _resolveFormula(s, actor) ?? s;
  try {
    return Number(Roll.safeEval(resolved));
  } catch (err) {
    console.warn(`case-by-case | critRange bonus "${bonusName}" has an unevaluable formula ("${s}"${resolved !== s ? ` -> "${resolved}"` : ""}) and was skipped:`, err);
    return NaN;
  }
}

function _evalIntFormula(formula, actor) {
  const s = String(formula ?? "").trim();
  if (!s) return 0;
  const resolved = _resolveFormula(s, actor) ?? s;
  try {
    const r = new Roll(resolved).evaluateSync({ strict: false });
    const n = Number(r.total);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  } catch {
    try {
      const n = Number(Roll.safeEval(resolved));
      return Number.isFinite(n) ? Math.trunc(n) : 0;
    } catch {
      return 0;
    }
  }
}

// One-shot rollConfig shape log.
const _loggedRollConfigShapes = new Set();
function _logRollConfigShapeOnce(hookName, rollConfig, subject) {
  if (_loggedRollConfigShapes.has(hookName)) return;
  _loggedRollConfigShapes.add(hookName);
  _debug(`case-by-case | rollConfig shape for ${hookName} (diagnostic, one-time):`, {
    keys: Object.keys(rollConfig ?? {}),
    subject: rollConfig?.subject,
    actor: rollConfig?.actor,
    expectedSubject: subject,
    rollConfig,
  });
}

// Sync injection for attack / damage.

function _injectSync(rollConfig, rollType, dialog = null, message = null) {
  const actor = rollConfig.subject?.actor ?? rollConfig.actor;
  if (!actor) return;
  const rollingToken = _preferredToken(actor);

  // Attack-only crit range + foe attack handling.
  if (rollType === "attack") {
    _applyCritRange(rollConfig, actor, rollingToken);
    _applyFoeCritRange(rollConfig, actor);
    _applyFoeAttackBonus(rollConfig, actor, dialog);
  }

  const useKey = _useKey(rollConfig.subject, { message });

  // Use the optional flow's cross-deduped list if it prepared one, otherwise gather required bonuses normally.
  const pending = _pendingActivityBonuses.get(useKey);
  if (pending) _pendingActivityBonuses.delete(useKey);
  const required = pending ?? _deduplicateByTag(
    _gatherBonusData(actor, rollingToken, rollConfig, rollType).filter(b => !b.optional)
  );
  _debug("case-by-case | _injectSync: required bonus source", {
    useKey, rollType, hitStash: !!pending, pendingKeysAtLookup: [..._pendingActivityBonuses.keys()],
    required: required.map(b => ({ name: b.name, formula: b.formula, stackTag: b.stackTag })),
  });

  // Carried children from earlier accept.
  const carried = _stashConsume(useKey, rollType);

  const carriedBonuses = carried.map((c, i) => ({
    id: `carry:${i}`,
    name: "Carried Group Bonus",
    formula: c.bonus,
    modType: c.modType ?? "simple",
    stackTag: "",
    advantage: false,
    disadvantage: false,
    additionalD20: "0",
  }));
  const all = [...required, ...carriedBonuses];
  if (!all.length) return;

  _applyBonusesToRollConfig(rollConfig, all, actor);
  _syncDialogDefaultButton(dialog, rollConfig, all);
}

/** Apply required crit-range bonuses to attack rolls. */
function _applyCritRange(rollConfig, actor, rollingToken) {
  // Optional crit range is handled in the optional dialog path.
  const data = _gatherBonusData(actor, rollingToken, rollConfig, "critRange").filter(b => !b.optional);
  if (!data.length) return;
  let threshold = Infinity;
  for (const b of data) {
    const v = _evalCritThreshold(b.formula, actor, b.name);
    if (Number.isFinite(v)) threshold = Math.min(threshold, v);
  }
  if (!Number.isFinite(threshold)) return;
  threshold = Math.max(2, Math.min(20, threshold));   // a natural 1 always misses; 20 = normal
  for (const r of rollConfig.rolls ?? []) {
    r.options ??= {};
    const cur = Number(r.options.criticalSuccess ?? 20);
    r.options.criticalSuccess = Math.min(cur, threshold);
  }
}

// Optional bonus dialog.

/** Return the consumption block for simple, group, or critRange rows. */
function _rowConsumption(row) {
  if (row.kind === "simple") return row.bonus?.consumption;
  if (row.kind === "group") return row.group?.consumption;
  if (row.kind === "critRange") return row.bonus?.consumption;
  return null;
}

/** Read the currently available amount for a consumption target, used to cap spending UI and safety clamps. */
function _availableResourceAmount(actor, consumption) {
  if (!actor || !consumption?.enabled) return Infinity;
  try {
    switch (consumption.type) {
      case "uses":     return Number(actor.items.get(consumption.target)?.system?.uses?.value) || 0;
      case "quantity": return Number(actor.items.get(consumption.target)?.system?.quantity) || 0;
      case "resource": return Number(actor.system?.resources?.[consumption.target]?.value) || 0;
      case "spellSlot": return Number(actor.system?.spells?.[consumption.target]?.value) || 0;
      case "hp":       return Number(actor.system?.attributes?.hp?.value) || 0;
      case "currency": return Number(actor.system?.currency?.[consumption.target]) || 0;
      default:         return Infinity; // "effect" or anything unrecognized: no quantity to cap.
    }
  } catch { return Infinity; }
}

/** Whether a consumption block is the "Any Available Slot" spellSlot special-case. */
function _isAnySpellSlot(c) {
  return c?.type === "spellSlot" && c?.target === "any";
}

/** Build spell-slot choices for "Any Available Slot"; @consumed resolves to chosen slot level, not quantity. */
function _spellSlotChoices(actor) {
  const spells = actor?.system?.spells ?? {};
  const out = [];
  for (const [key, s] of Object.entries(spells)) {
    if (!s?.max) continue;
    const level = Number(s.level ?? key.replace("spell", "")) || 0;
    if (!level) continue;
    const label = key === "pact" ? "Pact Magic" : (CONFIG?.DND5E?.spellLevels?.[level] ?? `Level ${level}`);
    out.push({ key, level, available: Number(s.value) || 0, max: Number(s.max) || 0, label });
  }
  out.sort((a, b) => a.level - b.level);
  return out;
}

async function _promptOptional(optional, actor = null) {
  const { DialogV2 } = foundry.applications.api;
  // Cap each row's offered range by current affordability.
  const ranges = new Map(); // bonus id -> { min, max, affordable }
  const rows = optional.map(b => {
    const c = _rowConsumption(b);
    if (!c?.enabled) return `
    <label class="case-by-case-opt-row">
      <input type="checkbox" name="opt-${b.id}" checked />
      <strong>${foundry.utils.escapeHTML(b.name)}</strong>
      <code>${foundry.utils.escapeHTML(_bonusSummary(b))}</code>
      ${b.foeFiltered ? '<span class="case-by-case-opt-foe" title="Only offered because your current target matches this bonus\'s Target filter">vs. target</span>' : ""}
    </label>`;

    if (_isAnySpellSlot(c)) {
      const choices = _spellSlotChoices(actor).filter(s => s.available > 0);
      const affordable = choices.length > 0;
      ranges.set(b.id, { affordable });
      const consumeRow = affordable
        ? `<div class="case-by-case-opt-consume">
      <label>Spell Slot
        <select name="amt-${b.id}">
          ${choices.map(s => `<option value="${s.key}">${foundry.utils.escapeHTML(s.label)} (${s.available} available)</option>`).join("")}
        </select>
      </label>
    </div>`
        : `<div class="case-by-case-opt-consume case-by-case-opt-unaffordable">No spell slots available</div>`;
      return `
    <label class="case-by-case-opt-row">
      <input type="checkbox" name="opt-${b.id}" ${affordable ? "checked" : ""} ${affordable ? "" : "disabled"} />
      <strong>${foundry.utils.escapeHTML(b.name)}</strong>
      <code>${foundry.utils.escapeHTML(_bonusSummary(b))}</code>
      ${b.foeFiltered ? '<span class="case-by-case-opt-foe" title="Only offered because your current target matches this bonus\'s Target filter">vs. target</span>' : ""}
    </label>${consumeRow}`;
    }

    const available = _availableResourceAmount(actor, c);
    // Lock the row if the actor cannot afford c.min. Otherwise cap max by availability.
    const affordable = available >= c.min;
    const effMax = affordable ? Math.max(0, Math.min(c.max, available)) : 0;
    const effMin = affordable ? c.min : 0;
    ranges.set(b.id, { min: effMin, max: effMax, affordable });

    const consumeRow = !affordable
      ? `<div class="case-by-case-opt-consume case-by-case-opt-unaffordable">Not enough available (needs ${c.min}, have ${Number.isFinite(available) ? available : "0"})</div>`
      : (effMin === effMax
        ? `<div class="case-by-case-opt-consume">Costs ${effMin}${effMax < c.max ? ` (capped, only ${effMax} available)` : " (fixed)"}</div>`
        : `<div class="case-by-case-opt-consume">
      <label>Spend
        <input type="number" name="amt-${b.id}" min="${effMin}" max="${effMax}" step="1" value="${effMin}" />
        (${effMin}–${effMax})
      </label>
    </div>`);
    return `
    <label class="case-by-case-opt-row">
      <input type="checkbox" name="opt-${b.id}" ${affordable ? "checked" : ""} ${affordable ? "" : "disabled"} />
      <strong>${foundry.utils.escapeHTML(b.name)}</strong>
      <code>${foundry.utils.escapeHTML(_bonusSummary(b))}</code>
      ${b.foeFiltered ? '<span class="case-by-case-opt-foe" title="Only offered because your current target matches this bonus\'s Target filter">vs. target</span>' : ""}
    </label>${consumeRow}`;
  }).join("");

  return await DialogV2.prompt({
    window: { title: "Case by Case: Optional Bonuses" },
    content: `<div class="case-by-case-opt-dialog"><p>Choose which bonuses to apply:</p>${rows}</div>`,
    ok: {
      label: "Apply Selected",
      callback: (event, button) => {
        const form = button.form;
        // Fail closed: missing form means apply nothing.
        if (!form) return [];
        return optional.filter(b => form.elements[`opt-${b.id}`]?.checked).map(b => {
          const c = _rowConsumption(b);
          if (!c?.enabled) return b;
          if (_isAnySpellSlot(c)) {
            const range = ranges.get(b.id) ?? { affordable: false };
            if (!range.affordable) return { ...b, consumedAmount: 0, unaffordable: true };
            const key = form.elements[`amt-${b.id}`]?.value;
            const choice = _spellSlotChoices(actor).find(s => s.key === key && s.available > 0);
            if (!choice) return { ...b, consumedAmount: 0, unaffordable: true };
            // consumedAmount is slot level; spendAmount is always 1 slot.
            return { ...b, consumedAmount: choice.level, spendTarget: choice.key, spendAmount: 1 };
          }
          const range = ranges.get(b.id) ?? { min: c.min, max: c.max, affordable: true };
          if (!range.affordable) return { ...b, consumedAmount: 0, unaffordable: true };
          const raw = Number(form.elements[`amt-${b.id}`]?.value);
          // Clamp to affordability-aware range.
          const consumedAmount = Number.isFinite(raw) ? Math.min(range.max, Math.max(range.min, raw)) : range.min;
          return { ...b, consumedAmount };
        });
      },
    },
    rejectClose: false,
  }) ?? [];
}

/** Replace @consumed with the chosen literal amount. */
function _substituteConsumed(formula, amount) {
  return _substituteConsumedShared(formula, amount);
}

/** Resolve chosen simple rows: spend first, then substitute @consumed so unpaid bonuses never apply. */
async function _resolveChosenSimple(chosen, actor) {
  const rows = [];
  for (const r of chosen) {
    if (r.kind !== "simple") continue;
    const bonus = r.bonus;
    if (!bonus.consumption?.enabled) { rows.push(bonus); continue; }
    const amount = r.consumedAmount ?? bonus.consumption.min;
    // In "Any Available Slot", amount is level for @consumed; actual deduction is 1 slot.
    const consumption = r.spendTarget ? { ...bonus.consumption, target: r.spendTarget } : bonus.consumption;
    const spendAmount = r.spendAmount ?? amount;
    const ok = await _consumeResource(actor, consumption, spendAmount, bonus.id);
    if (!ok) {
      ui.notifications?.error(`Case by Case: couldn't spend the cost for "${bonus.name}" — that bonus was not applied.`);
      continue;
    }
    const resolved = _substituteConsumed(bonus.formula, amount);
    const out = { ...bonus, formula: resolved, consumedAmount: amount,
                  spendTarget: r.spendTarget, spendAmount };
    if ("bonus" in bonus) out.bonus = resolved;
    rows.push(out);
  }
  return _deduplicateByTag(rows);
}

/** Resolve chosen group rows: spend shared cost first, then substitute @consumed for all children. */
async function _resolveChosenGroups(chosen, actor) {
  const out = [];
  for (const r of chosen.filter(r => r.kind === "group")) {
    const g = r.group;
    if (!g.consumption?.enabled) { out.push(r); continue; }
    const amount = r.consumedAmount ?? g.consumption.min;
    // Same "Any Available Slot" override as _resolveChosenSimple.
    const spendConsumption = r.spendTarget ? { ...g.consumption, target: r.spendTarget } : g.consumption;
    const spendAmount = r.spendAmount ?? amount;
    const ok = await _consumeResource(actor, spendConsumption, spendAmount, g.id);
    if (!ok) {
      ui.notifications?.error(`Case by Case: couldn't spend the cost for "${g.name}" — that group's bonuses were not applied.`);
      continue;
    }
    const substChild = (c) => ({ ...c, bonus: _substituteConsumed(c.bonus, amount) });
    const resolvedGroup = {
      ...g,
      nowChildren:   (g.nowChildren ?? []).map(substChild),
      laterChildren: (g.laterChildren ?? []).map(substChild),
    };
    out.push({ ...r, group: resolvedGroup });
  }
  return out;
}

/** Resolve chosen critRange rows: spend first, then substitute @consumed into threshold formulas. */
async function _resolveChosenCritRange(chosen, actor) {
  const out = [];
  for (const r of chosen.filter(r => r.kind === "critRange")) {
    const bonus = r.bonus;
    if (!bonus.consumption?.enabled) { out.push(bonus); continue; }
    const amount = r.consumedAmount ?? bonus.consumption.min;
    // Same "Any Available Slot" override as _resolveChosenSimple.
    const consumption = r.spendTarget ? { ...bonus.consumption, target: r.spendTarget } : bonus.consumption;
    const spendAmount = r.spendAmount ?? amount;
    const ok = await _consumeResource(actor, consumption, spendAmount, bonus.id);
    if (!ok) {
      ui.notifications?.error(`Case by Case: couldn't spend the cost for "${bonus.name}" — that bonus was not applied.`);
      continue;
    }
    out.push({ ...bonus, formula: _substituteConsumed(bonus.formula, amount) });
  }
  return out;
}

/** Find the source document for a bonus id. */
function _findBonusHost(actor, bonusId) {
  for (const source of collectBonusSources(actor)) {
    if (peekBonuses(source).some(b => b.id === bonusId)) return source;
  }
  return null;
}

/**
 * Spend resources for an accepted consumption bonus.
 * @returns {Promise<boolean>} True only if payment/deletion actually succeeded.
 */
async function _consumeResource(actor, consumption, amount, bonusId) {
  if (!actor || !consumption?.enabled) return false;
  let n = Math.max(0, Number(amount) || 0);
  // Safety backstop for races: clamp again even though _promptOptional already capped values.
  const available = _availableResourceAmount(actor, consumption);
  if (Number.isFinite(available) && n > available) {
    console.warn(`case-by-case | _consumeResource: requested ${n} but only ${available} available (type "${consumption.type}", target "${consumption.target}"); clamping. This granted bonus may have used a higher @consumed value than was actually paid for — see _promptOptional's affordability check for why this shouldn't normally happen.`);
    n = available;
  }
  try {
    switch (consumption.type) {
      case "uses": {
        const item = actor.items.get(consumption.target);
        if (!item) { console.warn(`case-by-case | _consumeResource: "uses" target item ${consumption.target} not found on ${actor.name}.`); return false; }
        // `value` is derived; update `spent` instead.
        const spent = item.system?.uses?.spent ?? 0;
        await item.update({ "system.uses.spent": Math.max(0, spent + n) });
        return true;
      }
      case "quantity": {
        const item = actor.items.get(consumption.target);
        if (!item) { console.warn(`case-by-case | _consumeResource: "quantity" target item ${consumption.target} not found on ${actor.name}.`); return false; }
        const cur = item.system?.quantity ?? 0;
        await item.update({ "system.quantity": Math.max(0, cur - n) });
        return true;
      }
      case "resource": {
        const cur = actor.system?.resources?.[consumption.target]?.value ?? 0;
        await actor.update({ [`system.resources.${consumption.target}.value`]: Math.max(0, cur - n) });
        return true;
      }
      case "spellSlot": {
        const cur = actor.system?.spells?.[consumption.target]?.value ?? 0;
        await actor.update({ [`system.spells.${consumption.target}.value`]: Math.max(0, cur - n) });
        return true;
      }
      case "hp": {
        const cur = actor.system?.attributes?.hp?.value ?? 0;
        await actor.update({ "system.attributes.hp.value": Math.max(0, cur - n) });
        return true;
      }
      case "currency": {
        const cur = actor.system?.currency?.[consumption.target] ?? 0;
        await actor.update({ [`system.currency.${consumption.target}`]: Math.max(0, cur - n) });
        return true;
      }
      case "effect": {
        const host = _findBonusHost(actor, bonusId);
        if (!(host instanceof ActiveEffect)) { console.warn(`case-by-case | _consumeResource: "effect" host for bonus ${bonusId} not found or not an ActiveEffect.`); return false; }
        await host.delete();
        return true;
      }
      default:
        console.warn(`case-by-case | _consumeResource: unknown consumption type "${consumption.type}"`);
        return false;
    }
  } catch (err) {
    console.error(`case-by-case | _consumeResource failed (type "${consumption.type}", target "${consumption.target}"):`, err);
    return false;
  }
}

const MOD_TYPE_SUMMARY_LABELS = { reroll: "reroll", minDie: "min", maxDie: "max", explode: "explode", resize: "resize" };

function _bonusSummary(b) {
  const parts = [];
  const f = String(b.formula ?? "").trim();
  const modType = b.modType ?? "simple";
  if (modType !== "simple") {
    // Dice-mod formula is a threshold, not an added term.
    parts.push(`${MOD_TYPE_SUMMARY_LABELS[modType] ?? modType}${f && f !== "0" ? ` ${f}` : ""}`);
  } else if (f && f !== "0") {
    parts.push(f);
  }
  if (b.advantage) parts.push("adv");
  if (b.disadvantage) parts.push("dis");
  const extra = String(b.additionalD20 ?? "").trim();
  if (extra && extra !== "0") parts.push(`+${extra}d20`);
  return parts.join("; ") || "0";
}

// Stacking deduplication by tag.

/** Best-effort numeric estimate for stack-tag comparison only, exact arithmetic when possible else expected value. */
function _estimateFormulaValue(formula) {
  const s = String(formula ?? "").trim();
  if (!s) return null;
  try { return Roll.safeEval(s); } catch { /* fall through to dice-aware estimate */ }
  try {
    const roll = new Roll(s);
    let total = 0, sign = 1;
    for (const term of roll.terms) {
      if (term instanceof foundry.dice.terms.OperatorTerm) {
        if (term.operator === "-") sign = -1;
        else if (term.operator === "+") sign = 1;
        // Any other operator (*, /, parens, etc.) is outside what this estimator supports.
        else return null;
        continue;
      }
      if (term instanceof foundry.dice.terms.DiceTerm) {
        const n = Number(term.number) || 0;
        const faces = Number(term.faces) || 0;
        total += sign * n * (faces + 1) / 2;
      } else if (typeof term.number === "number") {
        total += sign * term.number;
      } else {
        // FunctionTerm, ParentheticalTerm, or anything else we don't have a safe estimate for.
        return null;
      }
    }
    return Number.isFinite(total) ? total : null;
  } catch { return null; }
}

/**
 * Composite score for a multipart group when comparing stack tags, summed so the group competes as one owner.
 * @param {object[]} children bonus.children
 * @param {(child: object) => string|null} formulaOf formula string to estimate for one child
 * @returns {number|null} null if no child produced an estimable value
 */
function _groupStackScore(children, formulaOf) {
  let total = 0, any = false;
  for (const child of children ?? []) {
    const v = _estimateFormulaValue(formulaOf(child));
    if (v !== null) { total += v; any = true; }
  }
  return any ? total : null;
}

/** Deduplicate formulas by stack tag, keeping adv/dis and extra-d20 flags, comparing by owner. */
function _deduplicateByTag(bonuses) {
  const winners = new Map(); // tag -> { ownerId, score }
  for (const b of bonuses) {
    const tag = (b.stackTag ?? "").trim().toLowerCase();
    if (!tag) continue;
    const ownerId = b.stackGroupId ?? b.id;
    const hasStackScore = "stackScore" in b;
    const rawScore = hasStackScore ? b.stackScore : _estimateFormulaValue(b.formula);
    // Explode uses a threshold: lower is stronger, so invert only for plain explode rows.
    const score = (rawScore !== null && !hasStackScore && b.modType === "explode") ? -rawScore : rawScore;
    const existing = winners.get(tag);
    if (!existing) { winners.set(tag, { ownerId, score }); continue; }
    if (existing.ownerId === ownerId) continue; // same owner already incumbent, nothing to compare
    // Replace only when both sides evaluate and the challenger is larger.
    if (score !== null && existing.score !== null && score > existing.score) {
      winners.set(tag, { ownerId, score });
    }
  }
  return bonuses.map(b => {
    const tag = (b.stackTag ?? "").trim().toLowerCase();
    if (!tag) return b;
    const ownerId = b.stackGroupId ?? b.id;
    if (winners.get(tag)?.ownerId === ownerId) return b;
    const zeroed = { ...b, formula: "0" };
    if ("bonus" in b) zeroed.bonus = "0";
    return zeroed;
  });
}

// Bonus collection.

/** Gather local and aura bonuses for one roll type. */
function _gatherBonusData(actor, rollingToken, config, rollType, targets = null, attackerToken = null) {
  const result = [];
  const foeMatchesCurrentTarget = (filters) =>
    !!(targets?.size && [...targets].some(t => _foeMatches(t, filters, attackerToken)));
  // Item-scoped bonuses only apply on their host item.
  const hostItemOk = (bonus, source) =>
    !bonus.scopeToHostItem || (source instanceof Item && _configItem(config)?.id === source.id);
  // Pass rolled item so local formulas can use item/scaling refs, same as the aura loop below.
  const rollItem = _configItem(config);
  // Same collision set _injectActorBonuses used to decide native routing at prep time -- keeps
  // this skip check in sync with what was actually baked in vs. left for roll-time gathering.
  const collidingTags = _actorCollidingStackTags(actor);

  // Local bonuses (on actor, items, effects)
  for (const source of _buildSources(actor)) {
    for (const bonus of peekBonuses(source)) {
      if (!bonus.enabled) continue;

      // Native self bonuses already applied at prep.
      if (_isNativeSelfBonus(bonus, collidingTags)) continue;

      const foeFiltered = _hasFoeFilters(bonus.filters);

      // Expand multipart children for this roll; each part filters independently on top of the group's own filters.
      if (bonus.kind === "multipart") {
        if (bonus.aura?.enabled) continue; // aura multiparts: see the aura loop below instead
        if (!hostItemOk(bonus, source)) continue;
        const timing = bonus.promptTiming ?? "associated";
        if (bonus.optional && timing !== "associated") continue;
        // Group-level non-foe filters gate the WHOLE group up front.
        if (!_filtersMatch(bonus, config, actor, rollType)) continue;
        if (foeFiltered) {
          // A required group's own foe filter is handled by _gatherFoeBonuses instead; optional groups are checked directly here.
          if (!bonus.optional) continue;
          if (!foeMatchesCurrentTarget(bonus.filters)) continue;
        }
        // One composite score for the whole group, reused on every child row below (see _groupStackScore).
        const groupScore = bonus.stackTag
          ? _groupStackScore(bonus.children, c => _resolveFormula(c.bonus, actor, rollItem))
          : null;
        for (const child of bonus.children ?? []) {
          if (child.type !== rollType) continue;
          // A required foe-filtered part only fires against a matching target; an optional one just isn't offered otherwise.
          if (_hasFoeFilters(child.filters)) {
            if (!bonus.optional) continue;
            if (!foeMatchesCurrentTarget(child.filters)) continue;
          }
          if (!_filtersMatch({ filters: child.filters, type: child.type }, config, actor, child.type)) continue;
          // Resolve @refs now so a stackTag comparison isn't comparing a raw ref string against a resolved number.
          const resolved = _resolveFormula(child.bonus, actor, rollItem);
          if (resolved !== null) {
            result.push({ id: `${bonus.id}:${child.id}`, name: `${bonus.name}: ${child.name}`,
                          formula: resolved, optional: !!bonus.optional, stackTag: bonus.stackTag ?? "",
                          stackGroupId: bonus.id, stackScore: groupScore,
                          modType: child.modType ?? "simple",
                          advantage: false, disadvantage: false, additionalD20: "0" });
          }
        }
        continue;
      }

      // Foe-filtered simple bonuses are handled elsewhere.
      if (foeFiltered) continue;
      if (bonus.aura?.enabled) continue;
      if (!hostItemOk(bonus, source)) continue;
      if (!_typeMatches(bonus, rollType))       continue;
      if (!_filtersMatch(bonus, config, actor, rollType)) continue;
      // Skip adv/dis when this roll kind already routed natively.
      const nativeRouted = _nativeAdvantageRoutesKind(bonus, rollType) && (bonus.advantage !== bonus.disadvantage);
      // Resolve @refs now, same as the aura path below, so local vs aura stackTag comparisons aren't apples-to-oranges.
      const localResolved = _resolveFormula(bonus.bonus, actor, rollItem);
      if (localResolved === null) continue;
      // Same @ref fix, one field over: the aura path already resolved additionalD20, local bonuses didn't.
      const localAddD20 = _resolveFormula(bonus.additionalD20 ?? "0", actor, rollItem) ?? (bonus.additionalD20 ?? "0");
      result.push({ id: bonus.id, name: bonus.name, formula: localResolved, type: bonus.type,
                    optional: !!bonus.optional, stackTag: bonus.stackTag ?? "",
                    advantage: !nativeRouted && !!bonus.advantage,
                    disadvantage: !nativeRouted && !!bonus.disadvantage,
                    additionalD20: localAddD20,
                    // Mod type decides additive vs threshold behavior.
                    modType: bonus.modType ?? "simple",
                    // Consumption is local simple-only.
                    consumption: bonus.consumption });
    }
  }

  // Aura bonuses: check range first, then filters.
  if (rollingToken) {
    // rollItem is already resolved above (shared with the local-bonus loop).
    for (const { token: sourceToken, actor: sourceActor, auras } of getAuraSources()) {
      for (const bonus of auras) {
        if (!isInAura(sourceToken, rollingToken, bonus.aura)) continue;

        if (bonus.kind === "multipart") {
          // Timed optional aura groups are prompted elsewhere.
          const timing = bonus.promptTiming ?? "associated";
          if (bonus.optional && timing !== "associated") continue;
          // Group-level filters checked against the recipient, same rule each child's own filters follow below.
          if (!_filtersMatch(bonus, config, actor, rollType)) continue;
          if (_hasFoeFilters(bonus.filters)) {
            // _gatherAuraFoeBonuses never handles multipart auras, so a required group foe filter has nowhere else to go; optional ones are checked directly here.
            if (!bonus.optional) continue;
            if (!foeMatchesCurrentTarget(bonus.filters)) continue;
          }
          // Project matching children from source, each filtering independently on top of the group-level check.
          // One composite score for the whole group (see _groupStackScore).
          const groupScore = bonus.stackTag
            ? _groupStackScore(bonus.children, c => _resolveFormula(c.bonus, sourceActor, rollItem))
            : null;
          for (const child of bonus.children ?? []) {
            if (child.type !== rollType) continue;
            if (_hasFoeFilters(child.filters)) {
              // Only optional associated foe-filtered parts are handled here.
              if (!bonus.optional) continue;
              if (!foeMatchesCurrentTarget(child.filters)) continue;
            }
            if (!_filtersMatch({ filters: child.filters, type: child.type }, config, actor, child.type)) continue;
            const resolved = _resolveFormula(child.bonus, sourceActor, rollItem);
            if (resolved !== null) {
              result.push({ id: `${bonus.id}:${child.id}`, name: `${bonus.name}: ${child.name}`,
                            formula: resolved, optional: !!bonus.optional, stackTag: bonus.stackTag ?? "",
                            stackGroupId: bonus.id, stackScore: groupScore,
                            modType: child.modType ?? "simple",
                            advantage: false, disadvantage: false, additionalD20: "0" });
            }
          }
        } else {
          // Simple foe-filtered aura bonuses are handled elsewhere.
          const foeFiltered = _hasFoeFilters(bonus.filters);
          if (foeFiltered) continue;
          if (!_typeMatches(bonus, rollType)) continue;
          if (!_filtersMatch(bonus, config, actor, rollType)) continue;
          const resolved = _resolveFormula(bonus.bonus, sourceActor, rollItem);
          if (resolved !== null) {
            const addD20Resolved = _resolveFormula(bonus.additionalD20 ?? "0", sourceActor, rollItem) ?? (bonus.additionalD20 ?? "0");
            // Suffix id by source token to avoid collisions.
            result.push({ id: `${bonus.id}@${sourceToken.id}`, name: bonus.name, formula: resolved, type: bonus.type,
                          optional: !!bonus.optional, stackTag: bonus.stackTag ?? "",
                          advantage: !!bonus.advantage, disadvantage: !!bonus.disadvantage,
                          additionalD20: addD20Resolved,
                          // Same modType meaning as local bonuses.
                          modType: bonus.modType ?? "simple" });
          }
        }
      }
    }
  }

  return result;
}

function _buildSources(actor) {
  return collectBonusSources(actor);
}

/** Pick one representative token for an actor on scene. */
function _preferredToken(actor) {
  if (!actor) return null;
  if (canvas?.ready) {
    const controlled = canvas.tokens?.controlled?.find(t => t.actor === actor);
    if (controlled) return controlled;
    const combatant = game.combat?.combatants?.find(c => c.actor === actor && c.token?.object);
    if (combatant?.token?.object) return combatant.token.object;
  }
  return actor.getActiveTokens?.()?.[0] ?? null;
}

// Matching helpers.

/** Match a bonus against the current roll type. */
function _typeMatches(bonus, rollType) {
  if (bonus.type === "advantage" || bonus.type === "disadvantage") {
    return _bonusRollKinds(bonus).includes(rollType);
  }
  return bonus.type === rollType;
}

/**
 * @param {Actor} actor
 * @param {string|null} kind "save" | "check" | "skill" (anything else always passes)
 * @param {object} config the roll config; ability/skill live at config.ability/config.skill
 * @param {string} want "proficient" | "expertise" | "either" | "none"
 */
function _proficiencyMatches(actor, kind, config, want) {
  let mult = null;
  if (kind === "save" && config.ability) {
    mult = Number(actor.system?.abilities?.[config.ability]?.saveProf?.multiplier);
  } else if (kind === "check" && config.ability) {
    mult = Number(actor.system?.abilities?.[config.ability]?.checkProf?.multiplier);
  } else if (kind === "skill" && config.skill) {
    // Skills store their own resolved multiplier directly on .value once prepared.
    mult = Number(actor.system?.skills?.[config.skill]?.value);
  } else {
    // No ability/skill in context yet, so don't block the bonus over something we can't evaluate.
    return true;
  }
  if (!Number.isFinite(mult)) return true;
  switch (want) {
    case "proficient": return mult >= 1;   // fully proficient or better (includes Expertise)
    case "expertise":  return mult >= 2;   // Expertise only
    case "either":     return mult > 0;    // any proficiency bonus at all, including half (JOAT/Remarkable Athlete)
    case "none":       return mult <= 0;   // untrained
    default:           return true;
  }
}

function _filtersMatch(bonus, config, actor = null, rollType = null) {
  const f = bonus.filters ?? {};

  // Ability filter
  if (f.abilities?.length && config.ability && !f.abilities.includes(config.ability)) return false;

  // Skill filter
  if (f.skills?.length && config.skill && !f.skills.includes(config.skill)) return false;

  // Proficiency filter (save/check/skill only); uses the multipart-aware roll kind when passed (see _bonusRollKinds).
  if (f.proficiency?.trim() && actor) {
    const kind = rollType ?? bonus.type;
    if (!_proficiencyMatches(actor, kind, config, f.proficiency.trim())) return false;
  }

  // Action type filter.
  if (f.attackModes?.length) {
    const actionType = _actionType(config);
    if (actionType && !f.attackModes.includes(actionType)) return false;
  }

  // If these filters are set, missing item/school/level must fail.

  // Item type filter
  const item = config.item ?? config.subject?.item;
  if (f.itemTypes?.length && (!item || !f.itemTypes.includes(item.type))) return false;

  // Spell school filter
  if (f.spellSchools?.length) {
    const school = item?.system?.school;
    if (!school || !f.spellSchools.includes(school)) return false;
  }

  // Spell level filter
  const spellLevel = item?.system?.level ?? null;
  if (f.minSpellLevel != null && (spellLevel === null || spellLevel < Number(f.minSpellLevel))) return false;
  if (f.maxSpellLevel != null && (spellLevel === null || spellLevel > Number(f.maxSpellLevel))) return false;

  // Item property filters (weapon properties + spell components share system.properties)
  if (f.weaponProps?.length || f.spellComponents?.length) {
    const raw = item?.system?.properties;
    const props = raw instanceof Set ? raw : new Set(Array.isArray(raw) ? raw : []);
    if (f.weaponProps?.length && !f.weaponProps.some(p => props.has(p))) return false;
    if (f.spellComponents?.length && !f.spellComponents.some(p => props.has(p))) return false;
  }

  // Damage type filter — the activity deals one of these damage types
  if (f.damageTypes?.length) {
    const dt = _activityDamageTypes(config.subject ?? config.activity);
    if (!f.damageTypes.some(t => dt.has(t))) return false;
  }

  // Recipient creature filters.
  const needCreature = f.targetConditions?.length || f.targetTypes?.length
    || f.targetSizes?.length || f.targetMovement?.length || f.targetLanguages?.length
    || f.minSlots != null || f.maxSlots != null || f.targetBloodied != null
    || f.targetEffectName?.trim();
  if (needCreature && actor && !_creatureMatches(actor, f)) return false;

  // Rolling actor condition filter.
  if (f.actorConditions?.length && actor) {
    if (!f.actorConditions.some(cond => actor.statuses?.has(cond))) return false;
  }

  // Arbitrary comparison filter.
  if (f.comparison?.trim() && !_comparisonPasses(f.comparison, actor)) return false;

  return true;
}

/** Map damage-hook activity to damage, heal, or temphp bucket. */
function _activityBonusType(activity) {
  if (activity?.type !== "heal") return "damage";
  const raw = activity?.healing?.types;
  const types = raw instanceof Set ? raw : new Set(Array.isArray(raw) ? raw : []);
  return types.has("temphp") ? "temphp" : "heal";
}

/** True for roll types that can hit multiple targets. */
function _isMultiTargetRollType(rollType) {
  return rollType === "damage" || rollType === "heal" || rollType === "temphp";
}

/** Union of all damage types an activity's damage parts deal. */
function _activityDamageTypes(activity) {
  const set = new Set();
  for (const p of activity?.damage?.parts ?? []) {
    const t = p?.types;
    if (t instanceof Set) for (const x of t) set.add(x);
    else if (Array.isArray(t)) t.forEach(x => set.add(x));
    else if (p?.type) set.add(p.type);
  }
  return set;
}

/** Total spell slots currently available to an actor (all slot types summed). */
function _availableSlots(actor) {
  const spells = actor?.system?.spells ?? {};
  let n = 0;
  for (const slot of Object.values(spells)) n += Number(slot?.value) || 0;
  return n;
}

/** Check whether actor has a named effect. */
function _hasNamedEffect(actor, name, activeOnly) {
  const needle = String(name ?? "").trim().toLowerCase();
  if (!needle) return true;
  const effects = actor?.allApplicableEffects?.() ?? actor?.effects ?? [];
  for (const e of effects) {
    if (activeOnly && (e.disabled || e.isSuppressed)) continue;
    const label = String(e.name ?? e.label ?? "").toLowerCase();
    if (label.includes(needle)) return true;
  }
  return false;
}

/** Check recipient creature filters. */
function _creatureMatches(a, f) {
  if (!a) return true;

  // Status conditions
  if (f.targetConditions?.length && !f.targetConditions.some(c => a.statuses?.has(c))) return false;

  // Creature type.
  if (f.targetTypes?.length) {
    const d = a.system?.details ?? {};
    const type = d.type?.value ?? d.race?.system?.type?.value;
    if (!type || !f.targetTypes.includes(type)) return false;
  }

  // Size.
  if (f.targetSizes?.length) {
    const size = a.system?.traits?.size;
    if (!size || !f.targetSizes.includes(size)) return false;
  }

  // Movement.
  if (f.targetMovement?.length) {
    const mv = a.system?.attributes?.movement ?? {};
    if (!f.targetMovement.some(m => Number(mv[m]) > 0)) return false;
  }

  // Languages.
  if (f.targetLanguages?.length) {
    const raw = a.system?.traits?.languages?.value;
    const have = raw instanceof Set ? raw : new Set(Array.isArray(raw) ? raw : []);
    if (!have.has("ALL") && !f.targetLanguages.some(l => have.has(l))) return false;
  }

  // Available spell slots.
  if (f.minSlots != null || f.maxSlots != null) {
    const avail = _availableSlots(a);
    if (f.minSlots != null && avail < Number(f.minSlots)) return false;
    if (f.maxSlots != null && avail > Number(f.maxSlots)) return false;
  }

  // Recipient bloodied threshold.
  if (f.targetBloodied != null) {
    const hp = a.system?.attributes?.hp ?? {};
    const val = Number(hp.value) || 0, max = Number(hp.max) || 0;
    const pct = Number(f.targetBloodied) || 0;
    if (!(max > 0 && (val / max) * 100 <= pct)) return false;
  }

  // Named effect filter.
  if (f.targetEffectName?.trim() && !_hasNamedEffect(a, f.targetEffectName, f.targetEffectActiveOnly ?? true)) {
    return false;
  }

  return true;
}

/** Evaluate one comparison expression against roll data; unparseable expressions pass through. */
function _comparisonPasses(expr, actor) {
  const m = String(expr).match(/^(.*?)(<=|>=|==|!=|<|>)(.*)$/);
  if (!m) return true;
  const [, lhs, op, rhs] = m;
  const rollData = actor?.getRollData?.() ?? {};
  const side = (s) => {
    const replaced = Roll.replaceFormulaData(s.trim(), rollData);
    try { return Roll.safeEval(replaced); } catch { return replaced.trim(); }
  };
  const a = side(lhs), b = side(rhs);
  switch (op) {
    case "<=": return a <= b;
    case ">=": return a >= b;
    case "<":  return a <  b;
    case ">":  return a >  b;
    case "==": return a == b;   // eslint-disable-line eqeqeq
    case "!=": return a != b;   // eslint-disable-line eqeqeq
  }
  return true;
}

/**
 * Derive the dnd5e action type (mwak/rwak/msak/rsak) for an attack/damage roll on config.subject.
 * @returns {string|null}
 */
function _actionType(config) {
  const activity = config.subject ?? config.activity ?? config.item?.system?.activities?.contents?.[0];
  if (!activity) return null;
  if (activity.actionType) return activity.actionType;
  const t = activity.attack?.type;
  if (!t?.value) return null;
  return `${t.value === "ranged" ? "r" : "m"}${t.classification === "spell" ? "sak" : "wak"}`;
}

/** Resolve the roll's item from config fallbacks. @returns {Item|null} */
function _configItem(config) {
  return config.item ?? config.subject?.item ?? config.activity?.item ?? null;
}

// Shared formula resolver lives in formulaResolve.mjs.

// Foe damage engine (per target, via midi-qol).

/** Call on ready; only per-target foe-damage merging requires midi-qol. */
export function registerFoeDamageEngine() {
  if (!game.modules.get("midi-qol")?.active) {
    console.warn("case-by-case | midi-qol is not installed or not active. Foe-filtered Damage/Healing/Temp HP bonuses that need to apply a different amount per target on a multi-target roll will not work; everything else in the module is unaffected.");
    if (game.user?.isGM) {
      ui.notifications?.warn("Case by Case: midi-qol isn't active. Foe-filtered multi-target Damage/Healing bonuses won't apply until it's installed and enabled.", { permanent: false });
    }
    return;
  }
  // Phase 1: roll/post foe bonus cards.
  Hooks.on("midi-qol.preDamageRollComplete", (workflow) =>
    _rollAndPostFoeDamage(workflow).catch(err => console.error("case-by-case | foe damage roll failed:", err)));
  // Phase 2: merge into midi's per-target damage object.
  Hooks.on("midi-qol.preTargetDamageApplication", (token, details) =>
    _mergeFoeDamageForTarget(token, details));
  // Foe to-hit bonuses are handled in sync attack injection.
}

// Phase 1: roll/post foe bonuses, stash per target actor.

// Per-workflow idempotency guard.
const _foeDamageRolled = new WeakSet();

async function _rollAndPostFoeDamage(workflow) {
  _debug("case-by-case | preDamageRollComplete — workflow id:", workflow?.uuid ?? workflow?.id ?? null);
  if (workflow) {
    if (_foeDamageRolled.has(workflow)) {
      _debug("case-by-case | foe damage: already rolled for this workflow instance, skipping");
      return;
    }
    _foeDamageRolled.add(workflow);
  }

  const actor = workflow?.actor;
  const activity = workflow?.activity;
  const token = workflow?.token ?? _preferredToken(actor);
  if (!actor || !activity || !token) {
    _debug("case-by-case | foe damage: missing actor/activity/token, aborting", { actor: !!actor, activity: !!activity, token: !!token });
    return;
  }

  const config = { item: activity.item, subject: activity, activity };
  // Also covers foe-filtered heal/temphp.
  const rollType = _activityBonusType(activity);

  // Try the same key candidates accept time could have used (itemCardId, then workflow id/uuid), stopping at the first match.
  const keyCandidates = [
    _useKey(activity, { originId: workflow?.itemCardId ?? null }),
    _useKey(activity, { originId: workflow?.id ?? workflow?.uuid ?? null }),
    activity?.uuid ?? activity?.item?.uuid ?? null,
  ];
  let acceptedFoeDamage = [];
  for (const key of new Set(keyCandidates.filter(Boolean))) {
    const batch = _consumeAcceptedFoeDamage(key);
    if (batch.length) { acceptedFoeDamage = batch; break; }
  }

  // Local + aura + accepted optional foe bonuses.
  const bonuses = [
    ..._gatherFoeBonuses(actor, config, [rollType]),
    ..._gatherAuraFoeBonuses(actor, token, config, [rollType]),
    ...acceptedFoeDamage,
  ];
  _debug("case-by-case | foe damage: candidate bonuses found:", bonuses.length);
  if (!bonuses.length) return;

  const candidates = workflow.targets ?? new Set();
  _debug("case-by-case | foe damage: workflow targets:", candidates.size);
  if (!candidates.size) return;

  // Fallback output type for damage vs heal/temphp, used when a bonus's formula has no bracketed damage type of its own.
  const fallbackDmgType = rollType === "damage" ? (_activityPrimaryDamageType(activity) ?? "")
    : (rollType === "temphp" ? "temphp" : "healing");
  const speaker = ChatMessage.getSpeaker({ token, actor });

  for (const b of bonuses) {
    const matchedTokens = [...candidates].filter(t => _foeMatches(t, b.filters, token));
    _debug(`case-by-case | foe damage: bonus "${b.name}" matched ${matchedTokens.length} of ${candidates.size} target(s)`);
    if (!matchedTokens.length) continue;

    // A bonus's own formula (e.g. "1d8[radiant]") wins over the host weapon's damage type for resist/vulnerability checks.
    const dmgType = rollType === "damage"
      ? (_formulaPrimaryDamageType(b.bonus) ?? fallbackDmgType)
      : fallbackDmgType;

    // Resolve with actor + rolled item data.
    const resolvedFormula = _resolveFormula(String(b.bonus), actor, activity.item) ?? String(b.bonus);
    // Use plain Roll so no misleading apply-damage button appears.
    const roll = await new Roll(resolvedFormula).evaluate();
    const total = Number(roll.total) || 0;
    if (!total) continue;

    // Post the bonus roll card right away.
    await roll.toMessage({
      speaker,
      flavor: `${b.name}${dmgType ? ` (${dmgType})` : ""}`,
    });

    // Keep rollType for phase 2's damage-vs-healing branch, and stash a serializable workflow id alongside the live reference in case phase 2 runs on a different client.
    _stashFoeDamage(matchedTokens, {
      name: b.name, total, dmgType: dmgType || "none", rollType, workflow,
      workflowId: workflow?.uuid ?? workflow?.id ?? null,
    });
  }
}

// actorUuid -> short-lived phase1->phase2 queue entries.
const _foeDamagePending = new Map();
const FOE_DAMAGE_TTL = 120000; // ms — generous; a slow save-prompt/GM-confirm shouldn't expire it

function _stashFoeDamage(tokens, entry) {
  const ts = Date.now();
  for (const t of tokens) {
    const uuid = t?.actor?.uuid;
    if (!uuid) continue;
    const list = _foeDamagePending.get(uuid) ?? [];
    list.push({ ...entry, ts });
    _foeDamagePending.set(uuid, list);
  }
}

function _pruneFoeDamagePending() {
  const cutoff = Date.now() - FOE_DAMAGE_TTL;
  for (const [id, list] of _foeDamagePending) {
    const fresh = list.filter(e => e.ts >= cutoff);
    if (fresh.length) _foeDamagePending.set(id, fresh);
    else _foeDamagePending.delete(id);
  }
}

/** Apply foe-filtered crit range to attack roll config. */
function _applyFoeCritRange(rollConfig, actor) {
  const activity = rollConfig.subject;
  const config = { item: activity?.item, subject: activity, activity };
  const attackerToken = _preferredToken(actor);
  const bonuses = [
    ..._gatherFoeBonuses(actor, config, ["critRange"]),
    ..._gatherAuraFoeBonuses(actor, attackerToken, config, ["critRange"]),
  ];
  if (!bonuses.length) return;

  const targets = _getRollTargets(activity, rollConfig);
  if (!targets.size) return;

  let threshold = Infinity;
  for (const b of bonuses) {
    if (![...targets].some(t => _foeMatches(t, b.filters, attackerToken))) continue;
    const v = _evalCritThreshold(b.bonus, actor, b.name);
    if (Number.isFinite(v)) threshold = Math.min(threshold, v);
  }
  if (!Number.isFinite(threshold)) return;
  threshold = Math.max(2, Math.min(20, threshold));
  for (const r of rollConfig.rolls ?? []) {
    r.options ??= {};
    r.options.criticalSuccess = Math.min(Number(r.options.criticalSuccess ?? 20), threshold);
  }
}

/** Inject foe-filtered to-hit bonuses into attack roll config. */
function _applyFoeAttackBonus(rollConfig, actor, dialog = null) {
  const activity = rollConfig.subject;
  const config = { item: activity?.item, subject: activity, activity };
  const attackerToken = _preferredToken(actor);
  const bonuses = [
    ..._gatherFoeBonuses(actor, config, ["attack"]),
    ..._gatherAuraFoeBonuses(actor, attackerToken, config, ["attack"]),
  ];
  if (!bonuses.length) return;

  const targets = _getRollTargets(activity, rollConfig);
  if (!targets.size) return;

  const matched = [];
  for (const b of bonuses) {
    if (![...targets].some(t => _foeMatches(t, b.filters, attackerToken))) continue;
    matched.push({
      id: b.id,
      name: b.name,
      formula: b.bonus,
      // Keep modType; otherwise this defaults to simple.
      modType: b.modType ?? "simple",
      stackTag: b.stackTag ?? "",
      // Carry the group-stacking fields through too, dropping these here used to silently fall back to per-child comparison.
      stackGroupId: b.stackGroupId, stackScore: b.stackScore,
      advantage: !!b.advantage,
      disadvantage: !!b.disadvantage,
      additionalD20: b.additionalD20 ?? "0",
    });
  }
  if (!matched.length) return;

  const deduped = _deduplicateByTag(matched);
  _applyBonusesToRollConfig(rollConfig, deduped, actor);
  _syncDialogDefaultButton(dialog, rollConfig, deduped);
}

/** Phase 2: merge per-target foe damage on preTargetDamageApplication, via MidiQOL.modifyDamageBy and actor uuid correlation. */
function _mergeFoeDamageForTarget(token, details) {
  _pruneFoeDamagePending();

  const uuid = token?.actor?.uuid;
  const all = uuid ? _foeDamagePending.get(uuid) : null;
  const workflow = details?.workflow ?? null;
  const workflowId = workflow?.uuid ?? workflow?.id ?? null;

  // Consume only entries from this workflow, preferring the stable id (works across clients) and falling back to the live object reference.
  const sameWorkflow = (p) => (workflowId != null && p.workflowId != null)
    ? p.workflowId === workflowId
    : p.workflow === workflow;
  const mine = workflow ? (all ?? []).filter(sameWorkflow) : all;
  // Always log merge status.
  _debug("case-by-case | preTargetDamageApplication for", token?.name, "— pending foe bonuses:", mine?.length ?? 0,
    all && mine && all.length !== mine.length ? `(${all.length} total pending for this actor, from other workflows)` : "");
  if (!mine?.length) return;

  if (workflow && all) {
    const remaining = all.filter(p => !sameWorkflow(p));
    if (remaining.length) _foeDamagePending.set(uuid, remaining);
    else _foeDamagePending.delete(uuid);
  } else {
    _foeDamagePending.delete(uuid);
  }

  const ditem = details?.ditem ?? details?.damageItem;
  const modifyDamageBy = globalThis.MidiQOL?.modifyDamageBy;
  if (!ditem || typeof modifyDamageBy !== "function") {
    console.warn("case-by-case | preTargetDamageApplication: missing ditem or MidiQOL.modifyDamageBy for", token?.name, details);
    return;
  }

  const multiplier = typeof ditem.saveMultiplier === "number" ? ditem.saveMultiplier : (ditem.saved ? 0.5 : 1);
  // Read crit flag from workflow/detail fallbacks.
  const isCritical = !!(workflow?.isCritical ?? ditem?.critical ?? details?.critical);
  const item = workflow?.item ?? workflow?.activity?.item ?? null;

  let appliedTotal = 0;
  for (const p of mine) {
    // Damage-only scaling/traits; skip for heal/temphp.
    const isDamage = (p.rollType ?? "damage") === "damage";
    let scaled = Math.floor(p.total * multiplier);
    if (isCritical && isDamage) scaled *= 2;
    const amount = isDamage ? _applyDamageTraits(token.actor, p.dmgType, scaled, item) : scaled;
    if (!amount) continue;
    modifyDamageBy({ damageItem: ditem, value: amount, type: p.dmgType, reason: p.name });
    appliedTotal += amount;
  }
  if (appliedTotal) _debug(`case-by-case | merged +${appliedTotal} foe damage via MidiQOL.modifyDamageBy for`, token?.name);
}

/** Best-effort trait scaling for di/dr/dv with bypass support. */
function _applyDamageTraits(actor, type, amount, item = null) {
  if (!type || type === "none" || !amount) return amount;
  const traits = actor?.system?.traits ?? {};
  const rawProps = item?.system?.properties;
  const itemProps = rawProps instanceof Set ? rawProps : new Set(Array.isArray(rawProps) ? rawProps : []);
  const has = (key) => {
    const v = traits[key]?.value;
    return v instanceof Set ? v.has(type) : Array.isArray(v) && v.includes(type);
  };
  const bypassed = (key) => {
    const raw = traits[key]?.bypasses;
    const bypassSet = raw instanceof Set ? raw : new Set(Array.isArray(raw) ? raw : []);
    return [...bypassSet].some(code => itemProps.has(code));
  };
  if (has("di") && !bypassed("di")) return 0;
  if (has("dr") && !bypassed("dr")) return Math.floor(amount / 2);
  if (has("dv") && !bypassed("dv")) return amount * 2;
  return amount;
}

/** Gather local foe-filtered bonuses for the given roll types. */
function _gatherFoeBonuses(actor, config, types, wantOptional = false) {
  const out = [];
  for (const source of _buildSources(actor)) {
    for (const b of peekBonuses(source)) {
      if (!b.enabled || b.aura?.enabled) continue;
      if (!!b.optional !== wantOptional) continue;
      // Same host-item scope check as _gatherBonusData.
      if (b.scopeToHostItem && !(source instanceof Item && _configItem(config)?.id === source.id)) continue;

      if (b.kind === "multipart") {
        if (wantOptional) continue; // single per-group decision — handled elsewhere, see above
        // Group-level top-layer filters (restored alongside per-child filtering; see
        // BonusConfig's #getTabs) gate the WHOLE required group first -- a group whose own
        // filters don't pass contributes nothing at all, regardless of any child's own filters.
        // `types` is always a single-roll-type array at every call site, so types[0] stands in
        // for the ambient "current roll" the group-level Proficiency filter (if any) needs.
        if (!_filtersMatch(b, config, actor, types[0])) continue;
        const groupFoeFiltered = _hasFoeFilters(b.filters);
        // Each part filters independently on top of the group-level filters; if the group itself has a top-layer foe filter, every child inherits it (merged via _mergeFoeFilters). A child with no foe filter at all isn't foe-gated here and goes through _gatherBonusData's multipart branch instead.
        // One composite score for the whole group, left unresolved (raw child.bonus) to match how this function scores its own non-multipart rows.
        const groupScore = b.stackTag ? _groupStackScore(b.children, c => c.bonus) : null;
        for (const child of b.children ?? []) {
          if (!types.includes(child.type)) continue;
          const childFoeFiltered = _hasFoeFilters(child.filters);
          if (!groupFoeFiltered && !childFoeFiltered) continue;
          if (!_filtersMatch({ filters: child.filters, type: child.type }, config, actor, child.type)) continue;
          out.push({
            id: `${b.id}:${child.id}`,
            name: `${b.name}: ${child.name}`,
            bonus: child.bonus,
            filters: groupFoeFiltered ? _mergeFoeFilters(b.filters, child.filters) : child.filters,
            stackTag: b.stackTag ?? "",
            stackGroupId: b.id, stackScore: groupScore,
            advantage: false,
            disadvantage: false,
            additionalD20: "0",
          });
        }
        continue;
      }

      if (!_hasFoeFilters(b.filters)) continue;
      if (!_filtersMatch(b, config, actor)) continue;
      // Match via _typeMatches, not raw types.includes(b.type): an Advantage/Disadvantage bonus's real type is never the literal roll type it's routed for.
      if (!types.some(t => _typeMatches(b, t))) continue;
      out.push({
        ...b,
        stackTag: b.stackTag ?? "",
        advantage: !!b.advantage,
        disadvantage: !!b.disadvantage,
        additionalD20: b.additionalD20 ?? "0",
      });
    }
  }
  return out;
}

/** Gather aura-projected foe-filtered bonuses for this roller token. */
function _gatherAuraFoeBonuses(actor, rollingToken, config, types, wantOptional = false) {
  const out = [];
  if (!rollingToken) return out;
  const rollItem = _configItem(config);

  for (const { token: sourceToken, actor: sourceActor, auras } of getAuraSources()) {
    for (const b of auras) {
      const inAura = isInAura(sourceToken, rollingToken, b.aura);
      // Same _typeMatches fix as _gatherFoeBonuses: an aura-hosted Advantage/Disadvantage bonus's type is never literally "attack".
      const typeOk = types.some(t => _typeMatches(b, t));
      const foeOk = _hasFoeFilters(b.filters);
      const filtersOk = _filtersMatch(b, config, actor);

      if (!!b.optional !== wantOptional) continue;
      if (!typeOk) continue;
      if (!foeOk) continue;
      if (!inAura) continue;
      if (!filtersOk) continue;

      const resolved = _resolveFormula(b.bonus, sourceActor, rollItem);
      if (resolved == null) continue;
      const addD20Resolved = _resolveFormula(b.additionalD20 ?? "0", sourceActor, rollItem) ?? (b.additionalD20 ?? "0");
      out.push({
        ...b,
        // Suffix by source token to avoid id collisions.
        id: `${b.id}@${sourceToken.id}`,
        bonus: resolved,
        stackTag: b.stackTag ?? "",
        advantage: !!b.advantage,
        disadvantage: !!b.disadvantage,
        additionalD20: addD20Resolved,
        // Aura-projected bonuses are never consumable.
        consumption: { enabled: false, type: "uses", target: "", min: 1, max: 1 },
      });
    }
  }

  return out;
}

/** Targets of the current roll. Prefer dnd5e pre-roll config targets, then midi workflow, then user targets. */
function _getRollTargets(activity, rollConfig = null) {
  const fromConfig = rollConfig?.targets;
  if (fromConfig?.size) {
    _debug("case-by-case | _getRollTargets " + JSON.stringify({ source: "config", count: fromConfig.size }));
    return fromConfig;
  }
  if (Array.isArray(fromConfig) && fromConfig.length) {
    _debug("case-by-case | _getRollTargets " + JSON.stringify({ source: "configArray", count: fromConfig.length }));
    return new Set(fromConfig);
  }

  // This roll's own targets, from our live workflow cache, so a re-target mid-turn can't drift in.
  const liveWf = activity?.uuid ? _liveWorkflowByActivity.get(activity.uuid) : null;
  if (liveWf?.targets?.size) {
    _debug("case-by-case | _getRollTargets " + JSON.stringify({ source: "liveWorkflowCache", count: liveWf.targets.size }));
    return liveWf.targets;
  }

  // Backup check against midi's own registry, usually a no-op.
  const wf = globalThis.MidiQOL?.Workflow?.getWorkflowByActivityUuid?.(activity?.uuid);
  if (wf?.targets?.size) {
    _debug("case-by-case | _getRollTargets " + JSON.stringify({ source: "midiWorkflow", count: wf.targets.size }));
    return wf.targets;
  }

  _debug("case-by-case | _getRollTargets " + JSON.stringify({ source: "userTargets", count: game.user?.targets?.size ?? 0 }));
  return game.user?.targets ?? new Set();
}

/** Whether a target token satisfies a bonus's Foe filters. */
function _foeMatches(targetToken, f = {}, attackerToken = null) {
  const a = targetToken?.actor;
  if (!a) return false;

  if (f.foeConditions?.length && !f.foeConditions.some(c => a.statuses?.has(c))) return false;

  if (f.foeTypes?.length) {
    const d = a.system?.details ?? {};
    const type = d.type?.value ?? d.race?.system?.type?.value;
    if (!type || !f.foeTypes.includes(type)) return false;
  }
  if (f.foeSizes?.length) {
    const size = a.system?.traits?.size;
    if (!size || !f.foeSizes.includes(size)) return false;
  }
  if (f.foeMovement?.length) {
    const mv = a.system?.attributes?.movement ?? {};
    if (!f.foeMovement.some(m => Number(mv[m]) > 0)) return false;
  }
  if (f.foeLanguages?.length) {
    const raw = a.system?.traits?.languages?.value;
    const have = raw instanceof Set ? raw : new Set(Array.isArray(raw) ? raw : []);
    if (!have.has("ALL") && !f.foeLanguages.some(l => have.has(l))) return false;
  }
  if (f.foeBloodied != null) {
    const hp = a.system?.attributes?.hp ?? {};
    const val = Number(hp.value) || 0, max = Number(hp.max) || 0;
    const pct = Number(f.foeBloodied) || 0;
    if (!(max > 0 && (val / max) * 100 <= pct)) return false;
  }
  if (f.foeWithin != null) {
    if (!attackerToken) return false;
    if (getDistance(attackerToken, targetToken, Number(f.foeWithin)) > Number(f.foeWithin)) return false;
  }
  // Target has an Active Effect matching this name (see _hasNamedEffect's doc).
  if (f.foeEffectName?.trim() && !_hasNamedEffect(a, f.foeEffectName, f.foeEffectActiveOnly ?? true)) {
    return false;
  }
  return true;
}

/** The activity's primary (first) damage type, used as the bonus's damage type. */
function _activityPrimaryDamageType(activity) {
  for (const p of activity?.damage?.parts ?? []) {
    const types = p?.types;
    if (types instanceof Set && types.size) return [...types][0];
    if (Array.isArray(types) && types.length) return types[0];
    if (p?.type) return p.type;
  }
  return null;
}

/** Pull the first bracketed damage type tag out of a formula, e.g. "1d8[radiant]" -> "radiant"; null if missing or not a recognized type. */
function _formulaPrimaryDamageType(formula) {
  const match = String(formula ?? "").match(/\[(\w+)\]/);
  if (!match) return null;
  const type = match[1].toLowerCase();
  const known = CONFIG?.DND5E?.damageTypes;
  if (known && !(type in known)) return null;
  return type;
}

/** Roll a formula once against the actor's data; returns the numeric total (0 on failure). */
async function _rollAmount(formula, actor) {
  try {
    const roll = await new Roll(String(formula), actor.getRollData()).evaluate();
    return Number(roll.total) || 0;
  } catch (err) {
    console.error(`case-by-case | foe bonus roll failed for "${formula}":`, err);
    return 0;
  }
}