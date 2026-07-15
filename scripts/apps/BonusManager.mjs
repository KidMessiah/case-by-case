/**
 * case-by-case bonus workbench.
 * Shows the bonus list and the selected editor side by side in one window.
 */

import {
  getBonuses, addBonus, removeBonus, updateBonus, addChild, updateChild, removeChild,
  TARGETABLE_TYPES, hasFoeFilters, modTypesFor,
} from "../bonus.mjs";
import {
  TYPES, CHILD_TYPES, ROLL_KINDS, MOD_TYPE_LABELS, modTypeOptionsFor, DISPOSITIONS, TIMINGS,
  ABILITIES, SPELL_SCHOOLS, ITEM_TYPES, ATTACK_MODES, PROFICIENCY_OPTIONS, CONDITIONS,
  skillList, creatureTypeList, sizeList, movementList, languageList, damageTypeList,
  weaponPropList, spellComponentList, withSelected, splitOptions, defaultData,
} from "./BonusConfig.mjs";
import { refreshActorRadii } from "../radius.mjs";
import { applyTheme } from "../theme.mjs";
import { attachFormulaAutocomplete } from "./formulaAutocomplete.mjs";
import { attachFormulaPreview } from "./formulaPreview.mjs";
import { attachFormulaPresetButton } from "./formulaPresets.mjs";
import { CONSUMPTION_CATEGORIES, resourceOptionsFor, attachResourceCategorySelect } from "./resourcePicker.mjs";

// List-row labels.
const ROLL_TYPE_LABELS = {
  save: "Saving Throw", saveDC: "Spell Save DC", check: "Ability Check", skill: "Skill Check",
  attack: "Attack Roll", damage: "Damage Roll", heal: "Healing Roll", temphp: "Temporary HP Roll",
  critRange: "Critical Range", death: "Death Save", hitDie: "Hit Die", initiative: "Initiative",
};
const PARENT_ONLY_TYPE_LABELS = { advantage: "Advantage", disadvantage: "Disadvantage" };
const ALL_TYPE_LABELS = { ...ROLL_TYPE_LABELS, ...PARENT_ONLY_TYPE_LABELS };
const TIMING_LABELS = { associated: "ask before each roll", attack: "ask before hit", damage: "ask before damage" };
const AURA_DISPOSITION_LABELS = { 1: "Allies", "-1": "Enemies", 0: "Everyone" };

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BonusManager extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {Map<string, BonusManager>} open instances by document uuid */
  static #instances = new Map();

  /** Open (or focus) the workbench for a document. */
  static open(document) {
    const key = document.uuid;
    if (BonusManager.#instances.has(key)) {
      BonusManager.#instances.get(key).bringToFront();
      return;
    }
    const app = new BonusManager(document);
    BonusManager.#instances.set(key, app);
    app.render(true);
  }

  // Re-export from bonus.mjs.
  static TARGETABLE_TYPES = TARGETABLE_TYPES;

  // ---------------------------------------------------------------------------

  constructor(document, options = {}) {
    super({ ...options, uniqueId: document.uuid.replace(/\W/g, "-") });
    this.document = document;
    /** @type {{id: string|null, isNew: boolean, childContext: {parentId: string, childId: string|null, allowedTypes: string[]}|null}|null} */
    this.selection = null;
    /** Working copy for the current edit target. Always a valid object for the editor parts. */
    this.data = defaultData();
    this.tabGroups = { primary: "details" };
    // Re-render when the host item changes (e.g. its name, for the live formula preview).
    this._itemUpdateHookId = (document instanceof Item)
      ? Hooks.on("updateItem", (item) => { if (item.id === document.id) this.render(); })
      : null;
  }

  /** @type {Set<string>} Which Roll/Recipient/Target/Aura filter rows start (and stay) expanded. */
  #openFilters = new Set();

  static DEFAULT_OPTIONS = {
    id: "case-by-case-workbench-{id}",
    classes: ["dnd5e2", "application", "case-by-case", "bonus-workbench", "bonus-manager", "bonus-config", "standard-form"],
    tag: "form",
    window: {
      title: "Case by Case: Bonuses",
      icon: "fa-solid fa-gavel",
      contentClasses: ["standard-form"],
      resizable: true,
    },
    position: { width: 833, height: 700 },
    form: {
      handler: BonusManager.#onSubmit,
      closeOnSubmit: false,
    },
    actions: {
      // List
      addBonus:       BonusManager.#onAddBonus,
      addGroup:       BonusManager.#onAddGroup,
      editBonus:      BonusManager.#onEditBonus,
      deleteBonus:    BonusManager.#onDeleteBonus,
      toggleBonus:    BonusManager.#onToggleBonus,
      toggleOptional: BonusManager.#onToggleOptional,
      toggleRadius:   BonusManager.#onToggleRadius,
      addChild:       BonusManager.#onAddChild,
      editChild:      BonusManager.#onEditChild,
      deleteChild:    BonusManager.#onDeleteChild,
      copyBonus:      BonusManager.#onCopyBonus,
      pasteBonus:     BonusManager.#onPasteBonus,
      // Editor
      transferMove:     BonusManager.#onTransferMove,
      toggleSwitch:     BonusManager.#onToggleSwitch,
      toggleFilterOpen: BonusManager.#onToggleFilterOpen,
      cancelEdit:       BonusManager.#onCancelEdit,
    },
  };

  static #TAB_DEFS = [
    { id: "details", icon: "fa-solid fa-sliders",      label: "Details" },
    { id: "filters", icon: "fa-solid fa-filter",       label: "Roll" },
    { id: "target",  icon: "fa-solid fa-user-shield",  label: "Recipient" },
    { id: "foe",     icon: "fa-solid fa-crosshairs",   label: "Target" },
    { id: "aura",    icon: "fa-solid fa-circle-nodes", label: "Aura" },
  ];

  static PARTS = {
    list:    { template: "modules/case-by-case/templates/bonus-manager.hbs", scrollable: [".bonus-list"] },
    empty:   { template: "modules/case-by-case/templates/config-empty.hbs" },
    tabs:    { template: "templates/generic/tab-navigation.hbs" },
    details: { template: "modules/case-by-case/templates/config-details.hbs" },
    filters: { template: "modules/case-by-case/templates/config-filters.hbs" },
    target:  { template: "modules/case-by-case/templates/config-target.hbs" },
    foe:     { template: "modules/case-by-case/templates/config-foe.hbs" },
    aura:    { template: "modules/case-by-case/templates/config-aura.hbs" },
    footer:  { template: "modules/case-by-case/templates/config-footer.hbs" },
  };

  /**
   * All parts stay rendered. CSS swaps the empty state and editor pane because ApplicationV2 does
   * not reliably remove stale part elements.
   */

  // Keep the window title short but informative.
  get title() {
    const base = `Case by Case: ${this.document.name}`;
    if (!this.selection) return base;
    const label = this.selection.childContext
      ? (this.selection.isNew ? "Add Sub-Bonus" : (this.data?.name ? `Sub-Bonus: ${this.data.name}` : "Sub-Bonus"))
      : (this.selection.isNew ? "Add Bonus" : (this.data?.name || "Bonus"));
    return `${base} — ${label}`;
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  /**
  * Load a bonus, or a multipart child wrapped as a pseudo-bonus, into the editor pane.
   * @param {object|null} bonus  the bonus/child-pseudo-bonus to edit, or null to start a blank one
   * @param {{parentId: string, childId: string|null, allowedTypes: string[]}|null} childContext
   */
  #selectBonus(bonus, childContext) {
    const existing = childContext ? (childContext.childId ? bonus : null) : bonus;
    this.selection = { id: bonus?.id ?? null, isNew: !existing, childContext };
    this.data = foundry.utils.mergeObject(defaultData(), existing ?? {}, { inplace: false });
    this.#openFilters = this.#computeInitiallyOpenFilters();
    this.tabGroups.primary = "details";
  }

  /** Refresh `this.data` from the store after a save, without disturbing #openFilters. */
  #reloadSelectionData() {
    if (!this.selection) return;
    let existing = null;
    if (this.selection.childContext) {
      const parent = getBonuses(this.document).find(b => b.id === this.selection.childContext.parentId);
      const child = parent?.children?.find(c => c.id === this.selection.childContext.childId);
      existing = child ? BonusManager.#childPseudoBonus(child) : null;
    } else if (this.selection.id) {
      existing = getBonuses(this.document).find(b => b.id === this.selection.id) ?? null;
    }
    this.data = foundry.utils.mergeObject(defaultData(), existing ?? {}, { inplace: false });
  }

  /**
   * Keep the editor copy in sync when a list-row toggle changes the same bonus.
   */
  #syncSelectionIfEditing(bonusId) {
    if (this.selection && !this.selection.childContext && this.selection.id === bonusId) {
      this.#reloadSelectionData();
    }
  }

  /** Represent a child as a "simple" pseudo-bonus so the normal editor UI/logic applies as-is. */
  static #childPseudoBonus(child) {
    return { id: child.id, name: child.name, type: child.type, bonus: child.bonus, modType: child.modType ?? "simple", filters: child.filters ?? {} };
  }

  /** Restrict a child's Applies To options to match its siblings' targetable-vs-not bucket. */
  static #allowedChildTypes(parent, existing = null) {
    const siblings = (parent?.children ?? []).filter(c => c.id !== existing?.id);
    const allTypes = CHILD_TYPES.map(t => t.value);
    if (!siblings.length) return allTypes;
    const siblingsTargetable = TARGETABLE_TYPES.has(siblings[0].type);
    return allTypes.filter(t => TARGETABLE_TYPES.has(t) === siblingsTargetable);
  }

  /**
   * Filter rows that should start expanded for the current selection.
   */
  #computeInitiallyOpenFilters() {
    const f = this.data.filters ?? {};
    const open = new Set();
    for (const key of [
      "rollKinds",
      "abilities", "skills", "attackModes", "itemTypes", "weaponProps", "spellSchools", "spellComponents", "damageTypes",
      "targetConditions", "targetTypes", "targetSizes", "targetMovement", "targetLanguages",
      "foeConditions", "foeTypes", "foeSizes", "foeMovement", "foeLanguages",
    ]) {
      if ((f[key] ?? []).length) open.add(key);
    }
    if (f.minSpellLevel != null || f.maxSpellLevel != null) open.add("spellLevel");
    if (f.minSlots != null || f.maxSlots != null) open.add("spellSlots");
    if (f.targetBloodied != null) open.add("targetBloodied");
    if (f.targetEffectName?.trim()) open.add("targetEffectName");
    if (f.foeBloodied != null) open.add("foeBloodied");
    if (f.foeEffectName?.trim()) open.add("foeEffectName");
    if (f.foeWithin != null) open.add("foeWithin");
    if (f.comparison?.trim()) open.add("comparison");
    if ((this.data.aura?.blockedStatuses ?? []).length) open.add("blockedStatuses");
    return open;
  }

  /** Editing the multipart GROUP itself (not one of its children) -- see #childPseudoBonus. */
  #isGroupParent() {
    return this.data.kind === "multipart" && !this.selection?.childContext;
  }

  /** Build the tab records. */
  #getTabs() {
    const active = this.tabGroups.primary ?? "details";
    const tabs = {};
    const saveDC = this.#isSaveDC();
    for (const def of BonusManager.#TAB_DEFS) {
      // Aura projection is group-wide; a single part can't have its own range/disposition.
      if (this.selection?.childContext && def.id === "aura") continue;
      // Target (foe) filters need an opposing creature, which a passive Spell Save DC never has.
      if (saveDC && def.id === "foe") continue;
      // Aura projection for Spell Save DC was a cast-time-only hack that's been scoped out.
      if (saveDC && def.id === "aura") continue;
      const isActive = def.id === active;
      tabs[def.id] = { ...def, group: "primary", active: isActive, cssClass: isActive ? "active" : "" };
    }
    return tabs;
  }

  changeTab(tab, group, options) {
    if (!this.selection) return;
    if ((tab === "foe" || tab === "aura") && this.#isSaveDC()) return;
    if (tab === "foe" && !this.#isTargetable()) return;
    if (tab === "filters" && !this.#hasRollFilters()) return;
    super.changeTab(tab, group, options);
    this.tabGroups[group] = tab;
  }

  /** Whether this bonus is (a non-group) Spell Save DC bonus -- a group can never be this type. */
  #isSaveDC() {
    return !this.#isGroupParent() && (this.data.type ?? "save") === "saveDC";
  }

  /**
   * Whether the Target tab is relevant for the current mode.
   * Advantage/disadvantage is targetable only when it includes attack rolls.
   */
  #isTargetable() {
    if (this.#isGroupParent()) return this.#groupChildrenTargetable();
    const type = this.data.type ?? "save";
    if (type === "advantage" || type === "disadvantage") {
      const rollKinds = this.data.filters?.rollKinds ?? [];
      return !rollKinds.length || rollKinds.includes("attack");
    }
    return BonusManager.TARGETABLE_TYPES.has(type);
  }

  /** Whether the Roll tab should be active. Only Spell Save DC has no roll-context filters. */
  #hasRollFilters() {
    if (this.#isGroupParent()) return true;
    return (this.data.type ?? "save") !== "saveDC";
  }

  /** Whether a multipart group can be item-scoped from its child types. */
  #groupChildrenTargetable() {
    const children = this.data.children ?? [];
    return children.length > 0 && children.every(c => BonusManager.TARGETABLE_TYPES.has(c.type));
  }

  /** Check whether any relevant foe filter is set. */
  #hasFoeFilters() {
    if (this.#isGroupParent()) {
      return hasFoeFilters(this.data.filters) || (this.data.children ?? []).some(c => hasFoeFilters(c.filters));
    }
    return hasFoeFilters(this.data.filters);
  }

  /**
   * Lock mod type to "simple" for foe-filtered damage/heal/temp HP.
   * Those roll in their own message with no host die to modify.
   */
  #modTypeLocked() {
    if (this.#isGroupParent()) return false;
    const type = this.data.type ?? "save";
    return ["damage", "heal", "temphp"].includes(type) && this.#hasFoeFilters();
  }

  /** Check whether item scoping is available. */
  #supportsItemScope() {
    const targetable = this.#isGroupParent() ? this.#groupChildrenTargetable() : this.#isTargetable();
    return this.document instanceof Item && targetable && !this.data.aura?.enabled;
  }

  /**
   * Whether Consumption is available right now.
   * Multipart groups only support it for timed prompts, not associated prompts.
   */
  #consumptionOffered() {
    if (this.data.kind === "multipart" && (this.data.promptTiming ?? "associated") === "associated") return false;
    return !!this.data.optional && !this.data.aura?.enabled;
  }

  /** Capability snapshot for item-scoped filter locking. */
  static #itemCapabilities(item) {
    const activities = item?.system?.activities?.contents ?? [];
    return {
      attack: activities.some(a => a.type === "attack"),
      damage: activities.some(a => (a.damage?.parts?.length ?? 0) > 0),
      weapon: item?.type === "weapon",
      spell:  item?.type === "spell",
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  _onClose(options) {
    if (this._itemUpdateHookId != null) Hooks.off("updateItem", this._itemUpdateHookId);
    BonusManager.#instances.delete(this.document.uuid);
    super._onClose(options);
  }

  async _prepareContext(options) {
    const bonuses = getBonuses(this.document);
    const listContext = this.#prepareListContext(bonuses);
    // The editor parts always render (see the note above _configureRenderParts) even with no
    // real selection, so this always needs valid context data to feed them -- this.data is never
    // null (see the constructor), and #getTabs/etc. all null-guard this.selection internally.
    return { ...listContext, ...this.#prepareEditorContext(), hasSelection: !!this.selection };
  }

  /** Data for the list pane (left column). */
  #prepareListContext(bonuses) {
    return {
      document: this.document,
      // Radius rings only read actor bonuses.
      isActorDoc: this.document instanceof Actor,
      bonuses: bonuses.map(b => ({
        ...b,
        isMultipart: b.kind === "multipart",
        isSaveDC: b.type === "saveDC",
        optional: !!b.optional,
        foeFiltered: hasFoeFilters(b.filters),
        typeLabel: ALL_TYPE_LABELS[b.type] ?? b.type,
        timingLabel: TIMING_LABELS[b.promptTiming ?? "associated"],
        isAura: !!b.aura?.enabled,
        showRadius: !!b.aura?.showRadius,
        auraLabel: b.aura?.enabled ? `${b.aura.range}ft` : null,
        auraColor: b.aura?.color ?? "#4a90d9",
        auraDispositionLabel: AURA_DISPOSITION_LABELS[b.aura?.disposition] ?? "Everyone",
        stackTag: b.stackTag ?? (b.bonusType && b.bonusType !== "untyped" ? b.bonusType : ""),
        children: (b.children ?? []).map(c => ({ ...c, typeLabel: ROLL_TYPE_LABELS[c.type] ?? c.type })),
      })),
      count: bonuses.length,
      isEmpty: bonuses.length === 0,
    };
  }

  /**
   * Data for the editor pane (right column). Prepared on EVERY render, whether or not there's a
   * real selection, since the editor parts always render now -- see the note above
   * _configureRenderParts. With no selection this just describes this.data's placeholder content,
   * which stays hidden behind the "empty" pane via the has-selection class (see _onRender).
   */
  #prepareEditorContext() {
    const d = this.data;
    const f = d.filters ?? {};
    const a = d.aura ?? {};
    const childContext = this.selection?.childContext ?? null;
    const isNew = this.selection?.isNew ?? true;
    return {
      isNew,
      isMultipart: d.kind === "multipart",
      isChildMode: !!childContext,
      footerLabel: isNew ? (childContext ? "Add" : "Add Bonus") : (childContext ? "Save" : "Save Changes"),
      tabs: this.#getTabs(),
      // Details
      isItemHost: this.document instanceof Item,
      scopeToHostItem: !!d.scopeToHostItem,
      name: d.name ?? "",
      bonus: d.bonus ?? "0",
      advantage: !!d.advantage,
      disadvantage: !!d.disadvantage,
      grantsMode: d.grantsMode ?? true,
      additionalD20: d.additionalD20 ?? "0",
      optional: !!d.optional,
      timingOptions: withSelected(TIMINGS, [d.promptTiming ?? "associated"]),
      stackTag: d.stackTag ?? (d.bonusType && d.bonusType !== "untyped" ? d.bonusType : ""),
      typeOptions: withSelected(childContext ? CHILD_TYPES.filter(t => childContext.allowedTypes.includes(t.value)) : TYPES, [d.type]),
      modTypeOptions: this.#modTypeLocked()
        ? [{ value: "simple", label: MOD_TYPE_LABELS.simple, selected: true }]
        : modTypeOptionsFor(d.type, d.modType ?? "simple"),
      modTypeLocked: this.#modTypeLocked(),
      rollKinds: splitOptions(ROLL_KINDS, f.rollKinds ?? []),
      filters: {
        abilities:        splitOptions(ABILITIES,    f.abilities ?? []),
        skills:           splitOptions(skillList(),  f.skills ?? []),
        attackModes:      splitOptions(ATTACK_MODES, f.attackModes ?? []),
        itemTypes:        splitOptions(ITEM_TYPES,   f.itemTypes ?? []),
        spellSchools:     splitOptions(SPELL_SCHOOLS, f.spellSchools ?? []),
        spellComponents:  splitOptions(spellComponentList(), f.spellComponents ?? []),
        weaponProps:      splitOptions(weaponPropList(),     f.weaponProps ?? []),
        damageTypes:      splitOptions(damageTypeList(),     f.damageTypes ?? []),
        proficiency:      f.proficiency ?? "",
      },
      proficiencyOptions: withSelected(PROFICIENCY_OPTIONS, [f.proficiency ?? ""]),
      spellSlots: {
        enabled: f.minSlots != null || f.maxSlots != null,
        min: f.minSlots ?? "",
        max: f.maxSlots ?? "",
      },
      target: {
        conditions: splitOptions(CONDITIONS,         f.targetConditions ?? []),
        types:      splitOptions(creatureTypeList(), f.targetTypes ?? []),
        sizes:      splitOptions(sizeList(),         f.targetSizes ?? []),
        movement:   splitOptions(movementList(),     f.targetMovement ?? []),
        languages:  splitOptions(languageList(),     f.targetLanguages ?? []),
        bloodied:   f.targetBloodied ?? "",
        effectName: {
          enabled:    !!(f.targetEffectName && f.targetEffectName.trim()),
          value:      f.targetEffectName ?? "",
          activeOnly: f.targetEffectActiveOnly ?? true,
        },
      },
      foe: {
        conditions: splitOptions(CONDITIONS,         f.foeConditions ?? []),
        types:      splitOptions(creatureTypeList(), f.foeTypes ?? []),
        sizes:      splitOptions(sizeList(),         f.foeSizes ?? []),
        movement:   splitOptions(movementList(),     f.foeMovement ?? []),
        languages:  splitOptions(languageList(),     f.foeLanguages ?? []),
        within:     f.foeWithin ?? "",
        bloodied:   f.foeBloodied ?? "",
        effectName: {
          enabled:    !!(f.foeEffectName && f.foeEffectName.trim()),
          value:      f.foeEffectName ?? "",
          activeOnly: f.foeEffectActiveOnly ?? true,
        },
      },
      isTargetable: this.#isTargetable(),
      spellLevel: {
        enabled: f.minSpellLevel != null || f.maxSpellLevel != null,
        min: f.minSpellLevel ?? "",
        max: f.maxSpellLevel ?? "",
      },
      comparison: {
        enabled: !!(f.comparison && f.comparison.trim()),
        value: f.comparison ?? "",
      },
      aura: {
        enabled: !!a.enabled,
        range: a.range ?? 10,
        self: a.self ?? true,
        requiresConsciousness: a.requiresConsciousness ?? true,
        color: a.color ?? "#4a90d9",
      },
      dispositionOptions: withSelected(DISPOSITIONS, [String(a.disposition ?? 1)]),
      blockedStatuses:    splitOptions(CONDITIONS, a.blockedStatuses ?? []),
      consumption: this.#consumptionContext(),
    };
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    // Always assign (even when falsy) -- Foundry reuses the same context object across parts in
    // this loop, so a part with no tab entry (e.g. "aura" on a child, which #getTabs excludes)
    // would otherwise silently inherit whichever tab rendered as active immediately before it,
    // making that part's content show up "active" (and thus visible) alongside the real tab.
    context.tab = context.tabs?.[partId] ?? null;
    return context;
  }

  /** Keep the working copy synced while editing. */
  _onChangeForm(formConfig, event) {
    super._onChangeForm?.(formConfig, event);
    if (!this.selection) return;
    this.data = BonusManager.#readForm(this.element, this.data, this.document);
    this.#applyRollScope();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    applyTheme(this.element);
    // Swaps the "empty" placeholder vs. the editor pane's parts via CSS -- see the note above
    // _configureRenderParts for why this can't just be done by omitting parts from the render.
    this.element?.classList.toggle("has-selection", !!this.selection);
    this.#syncSelectionHighlight();
    if (!this.selection) return;
    this.element?.querySelector("nav.tabs")?.classList.add("sheet-tabs");
    this.#applyRollScope();
    this.#syncColorPreview();
    this.#attachFormulaAutocompletes();
    this.#attachFormulaPreview();
    this.#attachFormulaPresets();
    this.#attachResourcePicker();
    this.#syncFilterOpenState();
  }

  /** Highlight the bonus/child row that matches the current selection in the list pane. */
  #syncSelectionHighlight() {
    const root = this.element;
    root?.querySelectorAll(".bonus-row.case-by-case-row-selected, .child-row.case-by-case-row-selected")
      .forEach(el => el.classList.remove("case-by-case-row-selected"));
    if (!this.selection) return;
    if (this.selection.childContext) {
      root?.querySelector(`.bonus-row[data-bonus-id="${this.selection.childContext.parentId}"]`)
        ?.classList.add("case-by-case-row-selected");
      if (this.selection.childContext.childId) {
        root?.querySelector(`.child-row[data-child-id="${this.selection.childContext.childId}"]`)
          ?.classList.add("case-by-case-row-selected");
      }
    } else if (this.selection.id) {
      root?.querySelector(`.bonus-row[data-bonus-id="${this.selection.id}"]`)
        ?.classList.add("case-by-case-row-selected");
    }
  }

  /** Apply the independent expand/collapse state to each Roll-tab filter -- see #openFilters. */
  #syncFilterOpenState() {
    for (const el of this.element?.querySelectorAll(".case-by-case-filter[data-filter]") ?? []) {
      el.classList.toggle("case-by-case-filter-open", this.#openFilters.has(el.dataset.filter));
    }
  }

  /** Rebuild the consumption resource dropdown. */
  #attachResourcePicker() {
    const categorySelect = this.element?.querySelector(".case-by-case-resource-category");
    const targetSelect = this.element?.querySelector(".case-by-case-resource-target");
    if (!categorySelect || !targetSelect) return;
    const { actor } = this.#previewContext();
    attachResourceCategorySelect(categorySelect, targetSelect, actor, this.document);
  }

  /** Wire formula autocomplete on all tabs. */
  #attachFormulaAutocompletes() {
    const selectors = ['input[name="bonus"]', 'input[name="additionalD20"]', 'input[name="comparison"]'];
    for (const selector of selectors) {
      const el = this.element?.querySelector(selector);
      if (el) attachFormulaAutocomplete(el);
    }
  }

  /** Best-effort actor/item pair for previewing formulas. */
  #previewContext() {
    const doc = this.document;
    if (doc instanceof Actor) return { actor: doc, item: null };
    if (doc instanceof Item) return { actor: doc.actor ?? null, item: doc };
    const parent = doc?.parent ?? null;
    if (parent instanceof Actor) return { actor: parent, item: null };
    if (parent instanceof Item) return { actor: parent.actor ?? null, item: parent };
    return { actor: null, item: null };
  }

  /** Consumption dropdown context. */
  #consumptionContext() {
    const c = this.data.consumption ?? {};
    const { actor } = this.#previewContext();
    const categories = CONSUMPTION_CATEGORIES.filter(cat => cat.value !== "effect" || this.document instanceof ActiveEffect);
    return {
      enabled: !!c.enabled,
      type: c.type ?? "uses",
      target: c.target ?? "",
      min: c.min ?? 1,
      max: c.max ?? 1,
      typeOptions: withSelected(categories, [c.type ?? "uses"]),
      targetOptions: withSelected(resourceOptionsFor(actor, this.document, c.type ?? "uses"), [c.target ?? ""]),
    };
  }

  /** Live formula preview. */
  #attachFormulaPreview() {
    const input = this.element?.querySelector('input[name="bonus"]');
    const previewEl = this.element?.querySelector(".case-by-case-formula-preview");
    if (!input || !previewEl) return;
    const { actor, item } = this.#previewContext();
    const getConsumedAmount = () => {
      if (!this.data.consumption?.enabled) return null;
      if (this.data.consumption.type === "spellSlot" && this.data.consumption.target === "any") {
        const spells = actor?.system?.spells ?? {};
        let best = 0;
        for (const s of Object.values(spells)) {
          if ((s?.value ?? 0) > 0) best = Math.max(best, Number(s.level) || 0);
        }
        return best || 1;
      }
      return this.data.consumption.min ?? 0;
    };
    attachFormulaPreview(input, previewEl, actor, item, getConsumedAmount);
  }

  /** Formula preset button. */
  #attachFormulaPresets() {
    const input = this.element?.querySelector('input[name="bonus"]');
    const button = this.element?.querySelector(".case-by-case-preset-btn");
    attachFormulaPresetButton(button, input);
  }

  /** Paint the color inputs directly. */
  #syncColorPreview() {
    for (const input of this.element?.querySelectorAll('input[type="color"]') ?? []) {
      const paint = () => { input.style.background = input.value; };
      paint();
      input.oninput = paint;
    }
  }

  /** Rebuild mod-type options from the current live state. */
  #rebuildModTypeOptions() {
    const select = this.element?.querySelector('select[name="modType"]');
    if (!select) return;
    const locked = this.#modTypeLocked();
    const allowed = locked ? ["simple"] : (this.data.kind === "multipart" ? ["simple"] : modTypesFor(this.data.type));
    const current = this.data.modType ?? "simple";
    const selected = allowed.includes(current) ? current : "simple";
    if (selected !== this.data.modType) this.data.modType = selected;
    select.disabled = locked;
    if (locked) {
      select.dataset.tooltip = "Modification Type isn't available on a foe-filtered Damage/Heal/Temp HP bonus: it rolls as its own separate message with no other die in the roll to modify. Remove the Target filter to unlock this.";
    } else {
      select.removeAttribute("data-tooltip");
    }
    const existing = Array.from(select.options).map(o => o.value);
    const upToDate = existing.length === allowed.length && existing.every((v, i) => v === allowed[i]);
    if (upToDate && select.value === selected) return;
    select.innerHTML = allowed
      .map(value => `<option value="${value}" ${value === selected ? "selected" : ""}>${MOD_TYPE_LABELS[value]}</option>`)
      .join("");
    select.value = selected;
  }

  /** Tag the form for CSS scope and tab state. */
  #applyRollScope() {
    const type = this.data.kind === "multipart" ? "all" : (this.data.type ?? "all");
    if (!this.element) return;
    this.element.dataset.rolltype = type;
    this.#rebuildModTypeOptions();
    this.element.dataset.modtype = this.data.modType ?? "simple";
    const targetable = this.#isTargetable();
    this.element.dataset.targetable = String(targetable);

    const foeTab = this.element.querySelector('nav.tabs > [data-tab="foe"]');
    if (foeTab) {
      if (targetable) {
        foeTab.removeAttribute("data-tooltip");
      } else if (this.data.kind === "multipart") {
        foeTab.dataset.tooltip = (this.data.children ?? []).length
          ? "Target filters need every sub-bonus in this group to be Attack, Damage, Healing, Temp HP, or Crit Range. This group mixes in a type with no target."
          : "Add at least one sub-bonus (Attack, Damage, Healing, Temp HP, or Crit Range) before setting Target filters.";
      } else if (this.data.type === "advantage" || this.data.type === "disadvantage") {
        foeTab.dataset.tooltip = "Target filters need Attack among this bonus's roll kinds (Details tab). Save/Check/Skill/Death Save/Hit Die/Initiative have no opposing creature to filter on.";
      } else {
        foeTab.dataset.tooltip = "Target filters apply to attack, damage, healing, temp HP, and crit range. This roll type has no target.";
      }
    }

    const filtersTab = this.element.querySelector('nav.tabs > [data-tab="filters"]');
    if (filtersTab) {
      if (this.#hasRollFilters()) filtersTab.removeAttribute("data-tooltip");
      else filtersTab.dataset.tooltip = "Spell Save DC has no roll-context filters to narrow. It's a flat bonus to your Spell Save DC.";
    }

    if (this.#isGroupParent()) {
      const timingSelect = this.element.querySelector('select[name="promptTiming"]');
      if (timingSelect) {
        const childrenTargetable = this.#groupChildrenTargetable();
        for (const opt of timingSelect.options) opt.disabled = !childrenTargetable && opt.value !== "associated";
        if (!childrenTargetable && timingSelect.value !== "associated") timingSelect.value = "associated";
        timingSelect.dataset.tooltip = childrenTargetable ? "" :
          "Only \"ask before each associated roll\" works here: Saving Throw, Ability Check, Skill Check, Death Save, Hit Die, and Initiative have no attack or damage roll of their own to time a group prompt against.";
      }
    }

    const optionalRow = this.element.querySelector('.case-by-case-toggle-row[data-name="optional"]');
    if (optionalRow) {
      const optionalToggle = optionalRow.querySelector(".case-by-case-toggle");
      if (optionalToggle) {
        optionalToggle.dataset.tooltip = (this.data.kind === "multipart" && this.#hasFoeFilters())
          ? "This group has Target filters set. As an optional bonus, it'll only be offered in the pre-roll dialog when your current target actually matches those filters."
          : "";
      }
    }

    const scopeRow = this.element.querySelector('.case-by-case-toggle-row[data-name="scopeToHostItem"]');
    if (scopeRow) {
      const supported = this.#supportsItemScope();
      const scopeToggle = scopeRow.querySelector(".case-by-case-toggle");
      scopeRow.classList.toggle("case-by-case-row-locked", !supported);
      // The tooltip goes on the ROW, not the toggle icon: .case-by-case-row-locked sets
      // pointer-events:none on .case-by-case-toggle (so it can't be clicked while locked), which
      // also silently blocks hover detection for a data-tooltip set on that same element -- the
      // row itself has no such restriction, so hovering anywhere over a locked row still works.
      scopeRow.dataset.tooltip = supported ? "" :
        this.data.aura?.enabled
          ? "Aura bonuses can't be scoped to a single item. A recipient isn't rolling with the aura source's item."
          : "Only available for Attack, Damage, Healing, Temp HP, or Crit Range (the roll types tied to one specific item/activity).";
      if (scopeToggle) {
        if (!supported && scopeToggle.classList.contains("fa-toggle-on")) {
          scopeToggle.classList.remove("fa-toggle-on");
          scopeToggle.classList.add("fa-toggle-off");
          scopeToggle.setAttribute("aria-checked", "false");
        }
      }
    }

    const consumeFieldset = this.element.querySelector(".case-by-case-consume-fieldset");
    if (consumeFieldset) {
      const offered = this.#consumptionOffered();
      const consumeRow = consumeFieldset.querySelector('.case-by-case-toggle-row[data-name="consumeResource"]');
      const consumeToggle = consumeRow?.querySelector(".case-by-case-toggle");
      consumeRow?.classList.toggle("case-by-case-row-locked", !offered);
      // Same reasoning as scopeRow above: the tooltip goes on the row, not the pointer-events:none
      // toggle icon, or it can never be hovered into view while locked.
      if (consumeRow) {
        consumeRow.dataset.tooltip = offered ? "" : this.data.aura?.enabled
          ? "Not available for aura bonuses. The resource would need to be spent by whoever receives the aura, not the actor this bonus is configured on."
          : (this.data.kind === "multipart" && (this.data.promptTiming ?? "associated") === "associated")
            ? "Not available with When To Ask set to \"ask before each associated roll\": each part prompts independently there, with no single group-accept moment to charge a shared cost against. Switch When To Ask to before the attack or damage roll to enable this."
            : "Only meaningful on an Optional bonus. Turn Optional on for this bonus (from the bonus list) to configure a resource cost.";
      }
      if (consumeToggle) {
        if (!offered && consumeToggle.classList.contains("fa-toggle-on")) {
          consumeToggle.classList.remove("fa-toggle-on");
          consumeToggle.classList.add("fa-toggle-off");
          consumeToggle.setAttribute("aria-checked", "false");
        }
      }
      const body = consumeFieldset.querySelector(".case-by-case-consume-body");
      if (body) body.style.display = (offered && this.data.consumption?.enabled) ? "" : "none";

      const amountGroup = consumeFieldset.querySelector(".case-by-case-consume-amount-group");
      const anyNote = consumeFieldset.querySelector(".case-by-case-consume-any-note");
      if (amountGroup && anyNote) {
        const isAny = this.data.consumption?.type === "spellSlot" && this.data.consumption?.target === "any";
        amountGroup.style.display = isAny ? "none" : "";
        anyNote.style.display = isAny ? "" : "none";
      }
    }

    const cap = (this.#supportsItemScope() && this.data.scopeToHostItem)
      ? BonusManager.#itemCapabilities(this.document) : null;
    const lockFilter = (key, capable, reason) => {
      const el = this.element.querySelector(`.case-by-case-filter[data-filter="${key}"]`);
      if (!el) return;
      const locked = !!cap && !capable;
      el.classList.toggle("case-by-case-filter-locked", locked);
      el.dataset.tooltip = locked ? reason : "";
      const cb = el.querySelector(".case-by-case-filter-enable");
      if (cb) cb.disabled = locked;
    };
    lockFilter("attackModes", cap?.attack ?? true,
      "This item has no Attack activity. Attack / Spell Action can never match while scoped to this item only.");
    lockFilter("damageTypes", cap?.damage ?? true,
      "This item has no activity that deals damage. Damage Types can never match while scoped to this item only.");
    lockFilter("weaponProps", cap?.weapon ?? true,
      "This item isn't a Weapon. Weapon Properties can never match while scoped to this item only.");
    lockFilter("spellSchools", cap?.spell ?? true,
      "This item isn't a Spell. Spell Schools can never match while scoped to this item only.");
    lockFilter("spellComponents", cap?.spell ?? true,
      "This item isn't a Spell. Spell Components can never match while scoped to this item only.");
    lockFilter("spellLevel", cap?.spell ?? true,
      "This item isn't a Spell. Spell Level can never match while scoped to this item only.");
    lockFilter("itemTypes", !cap,
      "Redundant once scoped to this exact item. Item Types can only ever be this item's own type.");
  }

  // ---------------------------------------------------------------------------
  // List actions
  // ---------------------------------------------------------------------------

  static #onAddBonus() {
    this.#selectBonus(null, null);
    this.render();
  }

  /** Create a group, then select it for editing. */
  static async #onAddGroup() {
    const created = await addBonus(this.document, {
      kind: "multipart", name: "New Group", optional: true,
      promptTiming: "associated", type: "all", children: [],
    });
    const bonus = getBonuses(this.document).find(b => b.id === created.id);
    this.#selectBonus(bonus, null);
    this.render();
  }

  /**
   * Write text to the clipboard. `navigator.clipboard` only exists in "secure contexts" (HTTPS,
   * or localhost) -- a player connecting to the game over plain HTTP (e.g. by IP address, no
   * reverse-proxy TLS) gets `navigator.clipboard === undefined` outright, not even a permission
   * prompt, which threw here as "Cannot read properties of undefined (reading 'writeText')".
   * Falls back to the legacy selection + execCommand("copy") trick, which isn't gated on secure
   * context and still works in every browser that matters here.
   */
  static async #writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed; top:-9999px; left:-9999px; opacity:0;";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    document.body.removeChild(ta);
    if (!ok) throw new Error("Clipboard API and execCommand('copy') fallback both unavailable.");
  }

  /**
   * Read text from the clipboard. Same secure-context gap as #writeClipboard, but there's no
   * scriptable fallback for READING the clipboard over plain HTTP -- browsers block that
   * regardless of any trick, for any origin outside the real Clipboard API. Falls back to asking
   * the user to paste manually into a dialog instead.
   */
  static async #readClipboard() {
    if (navigator.clipboard?.readText) return navigator.clipboard.readText();
    return foundry.applications.api.DialogV2.prompt({
      window: { title: "Paste Bonus" },
      content: `
        <p>This connection can't use the automatic clipboard (that needs a secure/HTTPS
        connection). Paste the copied bonus below with Ctrl+V / Cmd+V, then Continue.</p>
        <textarea name="paste-target" rows="5" style="width:100%;"></textarea>
      `,
      ok: {
        label: "Continue",
        callback: (event, button) => button.form.elements["paste-target"].value,
      },
      rejectClose: false,
    });
  }

  /** Copy a bonus to the clipboard. */
  static async #onCopyBonus(event, target) {
    const bonusId = target.closest("[data-bonus-id]").dataset.bonusId;
    const bonus   = getBonuses(this.document).find(b => b.id === bonusId);
    if (!bonus) return;
    const { id, ...rest } = bonus;
    const payload = { cb: "bonus", version: 1, bonus: rest };
    try {
      await BonusManager.#writeClipboard(JSON.stringify(payload));
      ui.notifications.info(`Copied "${bonus.name}" to clipboard.`);
    } catch (err) {
      console.error("case-by-case | copy to clipboard failed:", err);
      ui.notifications.error("Couldn't copy to clipboard. See console for details.");
    }
  }

  /** Paste a copied bonus. */
  static async #onPasteBonus() {
    let text;
    try {
      text = await BonusManager.#readClipboard();
    } catch (err) {
      console.error("case-by-case | read from clipboard failed:", err);
      ui.notifications.error("Couldn't read the clipboard. See console for details.");
      return;
    }
    if (!text) return; // manual-paste dialog was cancelled, or the clipboard was empty
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      ui.notifications.warn("Clipboard doesn't contain a copied Case by Case bonus.");
      return;
    }
    if (payload?.cb !== "bonus" || !payload.bonus) {
      ui.notifications.warn("Clipboard doesn't contain a copied Case by Case bonus.");
      return;
    }

    const bonus = payload.bonus;
    if (bonus.scopeToHostItem) {
      const targetable = bonus.kind === "multipart"
        ? (bonus.children ?? []).length > 0 && bonus.children.every(c => TARGETABLE_TYPES.has(c.type))
        : TARGETABLE_TYPES.has(bonus.type ?? "save");
      const stillEligible = (this.document instanceof Item) && targetable && !bonus.aura?.enabled;
      if (!stillEligible) bonus.scopeToHostItem = false;
    }

    let danglingConsumption = false;
    if (bonus.consumption?.enabled && ["uses", "quantity"].includes(bonus.consumption.type)) {
      const actor = this.document instanceof Actor ? this.document : this.document.actor;
      if (!actor?.items.get(bonus.consumption.target)) {
        bonus.consumption.enabled = false;
        bonus.consumption.target = "";
        danglingConsumption = true;
      }
    }

    const created = await addBonus(this.document, bonus);
    this.render();
    ui.notifications.info(`Pasted "${created.name}".`);
    if (danglingConsumption) {
      ui.notifications.warn(`"${created.name}"'s resource consumption pointed at an item that doesn't exist here, so it was disabled. Re-link it in the bonus's Details tab if needed.`);
    }
  }

  static async #onToggleOptional(event, target) {
    const bonusId = target.closest("[data-bonus-id]").dataset.bonusId;
    const bonus   = getBonuses(this.document).find(b => b.id === bonusId);
    if (!bonus) return;
    if (bonus.type === "saveDC") return;
    await updateBonus(this.document, bonusId, { optional: !bonus.optional });
    this.#syncSelectionIfEditing(bonusId);
    this.render();
  }

  static async #onAddChild(event, target) {
    const bonusId = target.closest("[data-bonus-id]").dataset.bonusId;
    const parent = getBonuses(this.document).find(b => b.id === bonusId);
    if (!parent) return;
    this.#selectBonus(null, { parentId: parent.id, childId: null, allowedTypes: BonusManager.#allowedChildTypes(parent, null) });
    this.render();
  }

  static async #onEditChild(event, target) {
    const bonusId = target.closest("[data-bonus-id]").dataset.bonusId;
    const childId = target.closest("[data-child-id]").dataset.childId;
    const parent  = getBonuses(this.document).find(b => b.id === bonusId);
    const child   = parent?.children?.find(c => c.id === childId);
    if (!child) return;
    this.#selectBonus(
      BonusManager.#childPseudoBonus(child),
      { parentId: bonusId, childId, allowedTypes: BonusManager.#allowedChildTypes(parent, child) },
    );
    this.render();
  }

  static async #onDeleteChild(event, target) {
    const bonusId = target.closest("[data-bonus-id]").dataset.bonusId;
    const childId = target.closest("[data-child-id]").dataset.childId;
    if (this.selection?.childContext?.parentId === bonusId && this.selection?.childContext?.childId === childId) {
      this.selection = null;
      this.data = defaultData();
    }
    await removeChild(this.document, bonusId, childId);
    this.render();
  }

  static async #onEditBonus(event, target) {
    const bonusId = target.closest("[data-bonus-id]").dataset.bonusId;
    const bonus = getBonuses(this.document).find(b => b.id === bonusId);
    if (!bonus) return;
    this.#selectBonus(bonus, null);
    this.render();
  }

  static async #onDeleteBonus(event, target) {
    const bonusId = target.closest("[data-bonus-id]").dataset.bonusId;
    const bonus   = getBonuses(this.document).find(b => b.id === bonusId);
    if (!bonus) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Bonus" },
      content: `<p>Delete <strong>${foundry.utils.escapeHTML(String(bonus.name ?? ""))}</strong>? This cannot be undone.</p>`,
    });
    if (!confirmed) return;

    if (this.selection?.id === bonusId || this.selection?.childContext?.parentId === bonusId) {
      this.selection = null;
      this.data = defaultData();
    }
    await removeBonus(this.document, bonusId);
    this.render();
  }

  static async #onToggleBonus(event, target) {
    const bonusId = target.closest("[data-bonus-id]").dataset.bonusId;
    const bonus   = getBonuses(this.document).find(b => b.id === bonusId);
    if (!bonus) return;
    await updateBonus(this.document, bonusId, { enabled: !bonus.enabled });
    refreshActorRadii(this.document);
    this.#syncSelectionIfEditing(bonusId);
    this.render();
  }

  /** Per-bonus eye toggle: persistently show/hide this aura's radius ring. */
  static async #onToggleRadius(event, target) {
    const bonusId = target.closest("[data-bonus-id]").dataset.bonusId;
    const bonus   = getBonuses(this.document).find(b => b.id === bonusId);
    if (!bonus?.aura?.enabled) return;
    await updateBonus(this.document, bonusId, { aura: { showRadius: !bonus.aura.showRadius } });
    refreshActorRadii(this.document);
    this.#syncSelectionIfEditing(bonusId);
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Editor actions
  // ---------------------------------------------------------------------------

  /** Discard the in-progress edit and go back to list-only view. */
  static #onCancelEdit() {
    this.selection = null;
    this.data = defaultData();
    this.render();
  }

  /**
   * Expand/collapse one filter's body (Roll, Recipient, Target, or Aura tab), independent of its
   * enable checkbox -- see #openFilters.
   */
  static #onToggleFilterOpen(event, target) {
    const el = target.closest(".case-by-case-filter[data-filter]");
    if (!el) return;
    const key = el.dataset.filter;
    if (this.#openFilters.has(key)) this.#openFilters.delete(key);
    else this.#openFilters.add(key);
    el.classList.toggle("case-by-case-filter-open", this.#openFilters.has(key));
  }

  static #onTransferMove(event, target) {
    const li = target.closest("li");
    if (!li) return;
    const transfer = li.closest(".case-by-case-transfer");
    const fromAvailable = li.closest("[data-list]")?.dataset.list === "available";
    const dest = transfer?.querySelector(fromAvailable ? '[data-list="selected"]' : '[data-list="available"]');
    if (dest) dest.appendChild(li);
    this.data = BonusManager.#readForm(this.element, this.data, this.document);
  }

  /** Epic-Rolls-style switch: flip the fa-toggle-on/off icon. */
  static #onToggleSwitch(event, target) {
    if (target.dataset.field === "scopeToHostItem" && !this.#supportsItemScope()) return;
    if (target.dataset.field === "consumeResource" && !this.#consumptionOffered()) return;
    const on = !target.classList.contains("fa-toggle-on");
    target.classList.toggle("fa-toggle-on", on);
    target.classList.toggle("fa-toggle-off", !on);
    target.setAttribute("aria-checked", on ? "true" : "false");
    this.data = BonusManager.#readForm(this.element, this.data, this.document);
    this.#applyRollScope();
  }

  // ---------------------------------------------------------------------------
  // Form handling
  // ---------------------------------------------------------------------------

  static async #onSubmit(event, form, formData) {
    if (!this.selection) return;
    // Re-fetch the CURRENT bonus/child from the document instead of using `this.data` -- see the
    // old BonusConfig's identical concern: nothing else refreshes this.data while the editor sits
    // open (e.g. the updateItem hook triggers a render, but _prepareContext reads this.data too).
    const live = BonusManager.#liveExisting(this.document, this.selection);
    if (!this.selection.isNew && live == null) {
      ui.notifications?.warn("Case by Case: this bonus was deleted elsewhere -- nothing to save.");
      this.selection = null;
      this.data = defaultData();
      this.render();
      return;
    }
    const updated = BonusManager.#readForm(form, live ?? this.data, this.document);
    if (this.selection.childContext) {
      const childData = { name: updated.name, type: updated.type, bonus: updated.bonus,
                           modType: updated.modType, filters: updated.filters };
      if (this.selection.isNew) {
        const createdChild = await addChild(this.document, this.selection.childContext.parentId, childData);
        if (createdChild) this.selection.childContext.childId = createdChild.id;
      } else {
        await updateChild(this.document, this.selection.childContext.parentId, this.selection.childContext.childId, childData);
      }
    } else if (this.selection.isNew) {
      const created = await addBonus(this.document, updated);
      this.selection.id = created.id;
    } else {
      await updateBonus(this.document, this.selection.id, updated);
    }
    this.selection.isNew = false;
    refreshActorRadii(this.document);
    this.#reloadSelectionData();
    this.render();
  }

  /**
   * Look up the CURRENT version of the bonus (or child, wrapped via #childPseudoBonus) being
   * edited, straight from the document.
   * @returns {object|null} null when there's nothing live to look up yet (a brand-new bonus or
   *   child), or when the bonus/child/parent has been deleted elsewhere since it was selected.
   */
  static #liveExisting(document, selection) {
    if (selection.childContext) {
      if (!selection.childContext.childId) return null;
      const parent = getBonuses(document).find(b => b.id === selection.childContext.parentId);
      const child = parent?.children?.find(c => c.id === selection.childContext.childId);
      return child ? BonusManager.#childPseudoBonus(child) : null;
    }
    if (!selection.id) return null;
    return getBonuses(document).find(b => b.id === selection.id) ?? null;
  }

  /**
   * Read the full form into a bonus object. `existing` supplies untouched fields.
   * @param {HTMLElement|HTMLFormElement} formEl
   * @param {object} existing
   * @param {foundry.abstract.Document} [hostItem]  the document this bonus is being saved to;
   *   only used to gate scopeToHostItem and its item-capability filter clearing below.
   */
  static #readForm(formEl, existing = {}, hostItem = null) {
    const form = formEl instanceof HTMLFormElement ? formEl : formEl?.querySelector?.("form") ?? formEl;
    const data = new foundry.applications.ux.FormDataExtended(form).object;

    const enabled = (group) => !!form.querySelector(`.case-by-case-filter[data-filter="${group}"] .case-by-case-filter-enable`)?.checked;
    const picks = (group) => enabled(group)
      ? Array.from(form.querySelectorAll(`.case-by-case-transfer[data-filter="${group}"] [data-list="selected"] li`)).map(li => li.dataset.value)
      : [];
    const toggle = (field) => !!form.querySelector(`.case-by-case-toggle[data-field="${field}"]`)?.classList.contains("fa-toggle-on");
    const num = (v) => (v === "" || v == null) ? null : Number(v);
    const spellLevelOn = enabled("spellLevel");
    const spellSlotsOn = enabled("spellSlots");
    const isMultipart = existing?.kind === "multipart";

    const isAdvantageType = !isMultipart && (data.type === "advantage" || data.type === "disadvantage");
    const rollKindsPicks = isAdvantageType ? picks("rollKinds") : [];
    const isAdvantageTargetable = isAdvantageType && (!rollKindsPicks.length || rollKindsPicks.includes("attack"));

    const isMultipartTargetable = isMultipart
      && (existing?.children?.length ?? 0) > 0
      && existing.children.every(c => BonusManager.TARGETABLE_TYPES.has(c.type));
    const foeFieldsApply = isMultipartTargetable
      || isAdvantageTargetable
      || (!isMultipart && BonusManager.TARGETABLE_TYPES.has(data.type ?? "save"));
    const foePicks = (group) => foeFieldsApply ? picks(group) : [];

    const rollTabScopeApplies = isMultipart || BonusManager.TARGETABLE_TYPES.has(data.type ?? "save");
    const rollTabPicks = (group) => rollTabScopeApplies ? picks(group) : [];
    const damageScopeApplies = isMultipart || (data.type ?? "save") === "damage";

    const auraAllowed = isMultipart || (data.type ?? "save") !== "saveDC";
    const auraOn = auraAllowed && toggle("aura-enabled");
    const itemScopeOffered = (hostItem instanceof Item) && rollTabScopeApplies && !auraOn;
    const scopeToHostItem = itemScopeOffered && toggle("scopeToHostItem");

    const cap = scopeToHostItem ? BonusManager.#itemCapabilities(hostItem) : null;
    const capOk = (flag) => !cap || cap[flag];

    const formOptional = isMultipart ? toggle("optional") : (existing?.optional ?? false);
    const consumptionAllowed = !!formOptional && !auraOn
      && !(isMultipart && (data.promptTiming ?? existing?.promptTiming ?? "associated") === "associated");

    const out = {
      name:      (data.name ?? "").trim() || "Unnamed",
      enabled:   existing?.enabled ?? true,
      kind:      existing?.kind ?? "simple",
      stackTag:  (data.stackTag ?? "").trim(),
      scopeToHostItem,
      filters: {
        abilities:        picks("abilities"),
        skills:           picks("skills"),
        proficiency:      (data["filter-proficiency"] ?? "").trim(),
        rollKinds:        rollKindsPicks,
        attackModes:      capOk("attack") ? rollTabPicks("attackModes") : [],
        itemTypes:        cap ? [] : rollTabPicks("itemTypes"),
        spellSchools:     capOk("spell")  ? rollTabPicks("spellSchools") : [],
        spellComponents:  capOk("spell")  ? rollTabPicks("spellComponents") : [],
        weaponProps:      capOk("weapon") ? rollTabPicks("weaponProps") : [],
        damageTypes:      capOk("damage") && damageScopeApplies ? picks("damageTypes") : [],
        minSpellLevel:    (rollTabScopeApplies && capOk("spell") && spellLevelOn) ? num(data["filter-min-level"]) : null,
        maxSpellLevel:    (rollTabScopeApplies && capOk("spell") && spellLevelOn) ? num(data["filter-max-level"]) : null,
        minSlots:         spellSlotsOn ? num(data["filter-min-slots"]) : null,
        maxSlots:         spellSlotsOn ? num(data["filter-max-slots"]) : null,
        comparison:       enabled("comparison") ? (data.comparison ?? "").trim() : "",
        targetConditions: picks("targetConditions"),
        targetTypes:      picks("targetTypes"),
        targetSizes:      picks("targetSizes"),
        targetMovement:   picks("targetMovement"),
        targetLanguages:  picks("targetLanguages"),
        targetBloodied:   enabled("targetBloodied") ? num(data["target-bloodied"]) : null,
        targetEffectName: enabled("targetEffectName") ? (data["target-effect-name"] ?? "").trim() : "",
        targetEffectActiveOnly: enabled("targetEffectName") ? toggle("target-effect-active-only") : true,
        foeConditions:    foePicks("foeConditions"),
        foeTypes:         foePicks("foeTypes"),
        foeSizes:         foePicks("foeSizes"),
        foeMovement:      foePicks("foeMovement"),
        foeLanguages:     foePicks("foeLanguages"),
        foeWithin:        (foeFieldsApply && enabled("foeWithin")) ? num(data["foe-within"]) : null,
        foeBloodied:      (foeFieldsApply && enabled("foeBloodied")) ? num(data["foe-bloodied"]) : null,
        foeEffectName:    (foeFieldsApply && enabled("foeEffectName")) ? (data["foe-effect-name"] ?? "").trim() : "",
        foeEffectActiveOnly: (foeFieldsApply && enabled("foeEffectName")) ? toggle("foe-effect-active-only") : true,
      },
      aura: {
        enabled:               auraOn,
        range:                 Number(data["aura-range"]) || 10,
        disposition:           Number(data["aura-disposition"] ?? 1),
        self:                  toggle("aura-self"),
        requiresConsciousness: toggle("aura-consciousness"),
        blockedStatuses:       picks("blockedStatuses"),
        color:                 data["aura-color"] ?? "#4a90d9",
        showRadius:            existing?.aura?.showRadius ?? false,
      },
      consumption: {
        enabled: consumptionAllowed && toggle("consumeResource"),
        type:    data.consumeType ?? "uses",
        target:  data.consumeTarget ?? "",
        min:     Math.max(1, num(data.consumeMin) ?? 1),
        max:     Math.max(Math.max(1, num(data.consumeMin) ?? 1), num(data.consumeMax) ?? 1),
      },
    };

    if (isMultipart) {
      out.optional     = toggle("optional");
      out.promptTiming = data.promptTiming ?? existing?.promptTiming ?? "associated";
      out.type         = existing?.type ?? "all";
      out.bonus        = existing?.bonus ?? "0";
      out.advantage    = existing?.advantage ?? false;
      out.disadvantage = existing?.disadvantage ?? false;
      out.grantsMode   = existing?.grantsMode ?? true;
      out.additionalD20 = existing?.additionalD20 ?? "0";
      out.children     = existing?.children ?? [];
      out.modType      = "simple";
    } else {
      out.optional = existing?.optional ?? false;
      out.type     = data.type ?? "save";
      const allowedModTypes = modTypesFor(out.type);
      const rawModType = data.modType ?? existing?.modType ?? "simple";
      const modTypeLockedNow = ["damage", "heal", "temphp"].includes(out.type) && hasFoeFilters(out.filters);
      out.modType = (!modTypeLockedNow && allowedModTypes.includes(rawModType)) ? rawModType : "simple";
      if (isAdvantageType) {
        const grantsMode = toggle("grantsMode");
        out.bonus         = "0";
        out.grantsMode    = grantsMode;
        out.advantage     = out.type === "advantage" && grantsMode;
        out.disadvantage  = out.type === "disadvantage" && grantsMode;
        out.additionalD20 = (data.additionalD20 ?? "").trim() || "0";
      } else {
        out.bonus         = (data.bonus ?? "").trim() || "0";
        out.advantage     = false;
        out.disadvantage  = false;
        out.grantsMode    = true;
        out.additionalD20 = "0";
      }
    }
    return out;
  }
}
