/** case-by-case public API. */

import { getBonuses, addBonus, removeBonus, updateBonus } from "./bonus.mjs";

export const CaseByCaseAPI = {
  /** Direct bonus flag CRUD. */
  getBonuses,
  addBonus,
  removeBonus,
  updateBonus,

  // Convenience helpers.

  /** Add an aura bonus. */
  async addAura(document, {
    name                 = "Aura",
    type                 = "save",
    bonus                = "0",
    range                = 10,
    disposition          = 1,
    self                 = true,
    abilities            = [],
    skills               = [],
    requiresConsciousness = true,
    blockedStatuses      = [],
  } = {}) {
    return addBonus(document, {
      name,
      type,
      bonus,
      filters: { abilities, skills },
      aura: { enabled: true, range, disposition, self, requiresConsciousness, blockedStatuses },
    });
  },

  /** Add a non-aura bonus. */
  async addLocalBonus(document, {
    name       = "Bonus",
    type       = "save",
    bonus      = "0",
    abilities  = [],
    skills     = [],
  } = {}) {
    return addBonus(document, {
      name,
      type,
      bonus,
      filters: { abilities, skills },
      aura: { enabled: false, range: 0, disposition: 1, self: true, requiresConsciousness: false, blockedStatuses: [] },
    });
  },
};
