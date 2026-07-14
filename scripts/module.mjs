/** Case by Case entry point. */

import { registerPatches, registerRollHooks, registerActivityPatches, registerFoeDamageEngine } from "./hooks.mjs";
import { registerSheetButton } from "./sheetButton.mjs";
import { CaseByCaseAPI }         from "./api.mjs";
import { clearRadii, drawTokenRadii, refreshTokenRadii, redrawAllRadii, refreshActorRadii } from "./radius.mjs";
import { showAuraHints, clearAuraHints } from "./hover.mjs";
import { invalidateAuraRegistry, documentHasBonuses } from "./auraRegistry.mjs";
import { initThemeWatcher } from "./theme.mjs";

let _libWrapperMissing = false;

Hooks.once("init", () => {
  game.settings.register("case-by-case", "debug", {
    name: "Debug logging",
    hint: "Log Case by Case's internal roll/aura diagnostics to the console. Off by default. Leave off unless you're troubleshooting a bug, since it logs on every d20 roll anyone in the world makes.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  if (!globalThis.libWrapper) {
    console.error("case-by-case | lib-wrapper is not available. Module will not function.");
    _libWrapperMissing = true;
    return;
  }
  console.log("case-by-case | Initializing");
  registerPatches();
  registerSheetButton();
});

Hooks.once("ready", () => {
  // Stop here too if lib-wrapper never loaded.
  if (_libWrapperMissing) return;
  registerRollHooks();
  registerActivityPatches();
  registerFoeDamageEngine();
  initThemeWatcher();
  const mod = game.modules.get("case-by-case");
  mod.api = CaseByCaseAPI;
  globalThis.CaseByCase = CaseByCaseAPI;
  console.log("case-by-case | Ready.");
});

// Persistent aura rings.

// Draw, move, and redraw rings.
Hooks.on("drawToken", (token) => drawTokenRadii(token));
Hooks.on("refreshToken", (token) => refreshTokenRadii(token));
Hooks.on("canvasReady", () => redrawAllRadii());

// Remove rings when the token goes away.
Hooks.on("destroyToken", (token) => clearRadii(token.id));

// Hover hints only.
Hooks.on("hoverToken", (token, hovered) => hovered ? showAuraHints(token) : clearAuraHints());
Hooks.on("canvasReady", () => clearAuraHints());
Hooks.on("deleteToken", () => clearAuraHints());

// Refresh when bonus data changes.
Hooks.on("updateActor", (actor, changes) => {
  if (foundry.utils.hasProperty(changes, "flags.case-by-case")) {
    invalidateAuraRegistry();
    refreshActorRadii(actor);
  }
});
Hooks.on("updateItem", (item, changes) => {
  if (foundry.utils.hasProperty(changes, "flags.case-by-case") || documentHasBonuses(item)) {
    invalidateAuraRegistry();
    refreshActorRadii(item.parent);
  }
});

// Rebuild the aura source cache when sources change.
Hooks.on("canvasReady",  () => invalidateAuraRegistry());
Hooks.on("createToken",  () => invalidateAuraRegistry());
Hooks.on("deleteToken",  () => invalidateAuraRegistry());
Hooks.on("updateToken",  (tokenDoc, changes) => {
  // Hidden affects whether players can see a token's aura, so only invalidate when that flag changes.
  if (foundry.utils.hasProperty(changes, "hidden")) invalidateAuraRegistry();
});
Hooks.on("createItem",   (item) => { if (documentHasBonuses(item)) invalidateAuraRegistry(); });
Hooks.on("deleteItem",   (item) => { if (documentHasBonuses(item)) invalidateAuraRegistry(); });
Hooks.on("createActiveEffect", (e) => { if (documentHasBonuses(e)) invalidateAuraRegistry(); });
Hooks.on("deleteActiveEffect", (e) => { if (documentHasBonuses(e)) invalidateAuraRegistry(); });
Hooks.on("updateActiveEffect", (e, changes) => {
  if (documentHasBonuses(e) || foundry.utils.hasProperty(changes, "flags.case-by-case")) invalidateAuraRegistry();
});
