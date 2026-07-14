/** case-by-case aura registry. */

import { peekBonuses, collectBonusSources } from "./bonus.mjs";

/** @type {Array<{token: Token, actor: Actor, auras: object[]}> | null} */
let _cache = null;

/** Mark the cache stale. */
export function invalidateAuraRegistry() {
  _cache = null;
}

/** Get aura sources on the current scene. */
export function getAuraSources() {
  if (_cache) return _cache;
  _cache = [];
  for (const token of canvas?.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (!actor) continue;
    // Players should not see auras from GM-hidden tokens.
    if (token.document.hidden && !game.user?.isGM) continue;
    const auras = [];
    for (const doc of collectBonusSources(actor)) {
      for (const bonus of peekBonuses(doc)) {
        if (bonus.enabled && bonus.aura?.enabled) auras.push(bonus);
      }
    }
    if (auras.length) _cache.push({ token, actor, auras });
  }
  return _cache;
}

/** Check whether a document carries any case-by-case bonus. */
export function documentHasBonuses(doc) {
  if (peekBonuses(doc).length) return true;
  if (doc?.effects?.some?.(e => peekBonuses(e).length)) return true;
  return false;
}
