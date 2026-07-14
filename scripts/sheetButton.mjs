/** case-by-case sheet button hooks. */

import { BonusManager } from "./apps/BonusManager.mjs";

export function registerSheetButton() {
  // Tidy5e.
  Hooks.once("tidy5e-sheet.ready", (api) => {
    const control = {
      icon: "fa-solid fa-gavel",
      label: "Case by Case",
      async onClickAction(event) {
        BonusManager.open(this.document);
      },
      ownership: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
    };
    api.registerActorHeaderControls({ controls: [control] });
    // Older Tidy5e builds may not have this yet.
    if (typeof api.registerItemHeaderControls === "function") {
      api.registerItemHeaderControls({ controls: [control] });
    }
  });

  // Default dnd5e actor sheets.
  const dnd5eActorHooks = [
    "renderCharacterActorSheet",
    "renderNPCActorSheet",
    "renderVehicleActorSheet",
    "renderGroupActorSheet",
    // Legacy fallback.
    "renderActorSheet",
  ];
  for (const hookName of dnd5eActorHooks) {
    Hooks.on(hookName, (app) => injectDnd5eButton(app));
  }

  // Default dnd5e item sheets.
  Hooks.on("renderItemSheet5e", (app) => injectDnd5eButton(app));
  Hooks.on("renderContainerSheet", (app) => injectDnd5eButton(app));
  Hooks.on("renderItemSheet", (app) => injectDnd5eButton(app)); // Generic v1 fallback.

  // ActiveEffect config sheet uses the same button for effect-hosted bonuses.
  Hooks.on("renderActiveEffectConfig", (app) => injectDnd5eButton(app));

  Hooks.once("ready", () => {
    const seen = new Set(["ItemSheet5e", "ContainerSheet", "ItemSheet"]);
    try {
      for (const byId of Object.values(CONFIG.Item?.sheetClasses ?? {})) {
        for (const entry of Object.values(byId ?? {})) {
          const name = entry?.cls?.name;
          if (!name || seen.has(name)) continue;
          seen.add(name);
          Hooks.on(`render${name}`, (app) => injectDnd5eButton(app));
        }
      }
    } catch (err) {
      console.error("case-by-case | could not enumerate CONFIG.Item.sheetClasses:", err);
    }
  });
}

// ---------------------------------------------------------------------------

  /** Open the manager for the sheet's document. */
function injectDnd5eButton(app) {
  const doc = app.document ?? app.actor ?? app.item;
  if (!doc) return;

  // app.element works for both AppV1 and AppV2.
  const windowEl = app.element instanceof jQuery ? app.element[0] : app.element;
  if (!windowEl) return;

  const header = windowEl.querySelector(".window-header");
  if (!header) return;

  // Skip duplicates on rerender.
  if (header.querySelector(".case-by-case-sheet-btn")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("case-by-case-sheet-btn", "header-control");
  btn.title = "Case by Case: Manage Bonuses";
  btn.innerHTML = '<i class="fa-solid fa-gavel"></i>';
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    BonusManager.open(doc);
  });

  // Put it before the close button if possible.
  const closeBtn = header.querySelector('[data-action="close"], .close');
  if (closeBtn) header.insertBefore(btn, closeBtn);
  else header.appendChild(btn);
}