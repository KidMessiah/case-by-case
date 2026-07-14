/** case-by-case radius rings. */

import { peekBonuses } from "./bonus.mjs";

// tokenId -> Map<bonusId, PIXI.Graphics>
const _drawn = new Map();

/** Get the shared ring layer. */
function _layer() {
  const grid = canvas?.interface?.grid ?? canvas?.grid;
  if (!grid) return null;
  if (!grid.cbRings || grid.cbRings._destroyed) {
    grid.cbRings = grid.addChild(new PIXI.Container());
    grid.cbRings.eventMode = "none";
  }
  return grid.cbRings;
}

function _flaggedAuras(actor) {
  if (!actor) return [];
  return peekBonuses(actor).filter(b => b.enabled && b.aura?.enabled && b.aura?.showRadius);
}

/** Draw all radius rings for one token. */
export function drawTokenRadii(token) {
  if (!token?.id) return;
  clearRadii(token.id);
  const bonuses = _flaggedAuras(token.actor);
  if (!bonuses.length) return;
  const layer = _layer();
  if (!layer) return;

  const map = new Map();
  const c = token.center;
  for (const bonus of bonuses) {
    const g = _makeRing(token, bonus);
    if (!g) continue;
    g.position.set(c.x, c.y);
    layer.addChild(g);
    map.set(bonus.id, g);
  }
  if (map.size) _drawn.set(token.id, map);
}

/** Reposition rings, or redraw if they changed. */
export function refreshTokenRadii(token) {
  if (!token?.id) return;
  const map = _drawn.get(token.id);
  const expected = _flaggedAuras(token.actor);
  if (!map && !expected.length) return;

  const intact = map
    && map.size === expected.length
    && expected.every(b => {
      const g = map.get(b.id);
      return g && !g._destroyed && g.parent;
    });

  if (!intact) {
    drawTokenRadii(token);
    return;
  }
  const c = token.center;
  for (const g of map.values()) g.position.set(c.x, c.y);
}

/** Redraw rings for all active tokens of an actor. */
export function refreshActorRadii(doc) {
  const actor = doc instanceof Actor ? doc : doc?.actor ?? null;
  if (!actor) return;
  for (const token of actor.getActiveTokens?.() ?? []) drawTokenRadii(token);
}

/** Redraw rings for every token on the scene. */
export function redrawAllRadii() {
  for (const id of [..._drawn.keys()]) clearRadii(id);
  for (const token of canvas.tokens?.placeables ?? []) drawTokenRadii(token);
}

/** Clear rings for one token. */
export function clearRadii(tokenId) {
  const map = _drawn.get(tokenId);
  if (!map) return;
  for (const g of map.values()) {
    try { if (!g._destroyed) g.destroy(); } catch (_e) { /* already gone */ }
  }
  _drawn.delete(tokenId);
}

// ---------------------------------------------------------------------------

function _makeRing(token, bonus) {
  const dims = canvas.dimensions;
  if (!dims) return null;
  const pixelRange = (bonus.aura.range * dims.size) / dims.distance;

  const hex = foundry.utils.Color.from(bonus.aura.color ?? "#4a90d9");
  const g = new PIXI.Graphics();
  g.lineStyle(2, hex, 0.9);
  g.beginFill(hex, 0.06);

  // Match the ring to the scene's distance shape.
  const w = token.w ?? dims.size;
  const h = token.h ?? dims.size;
  switch (_gridAuraShape()) {
    case "square": {
      // 5-5-5 grid: square.
      const hw = pixelRange + w / 2;
      const hh = pixelRange + h / 2;
      g.drawRect(-hw, -hh, hw * 2, hh * 2);
      break;
    }
    case "diamond": {
      // No diagonals: diamond.
      const d = pixelRange + Math.max(w, h) / 2;
      g.drawPolygon([0, -d, d, 0, 0, d, -d, 0]);
      break;
    }
    default: {
      // Everything else: circle.
      const radius = pixelRange + (token.externalRadius ?? Math.hypot(w / 2, h / 2));
      g.drawCircle(0, 0, radius);
    }
  }

  g.endFill();
  return g;
}

/** Pick the ring shape for the current grid. */
function _gridAuraShape() {
  const grid = canvas?.grid;
  const T = CONST.GRID_TYPES ?? {};
  if (!grid || grid.type === T.GRIDLESS || grid.type !== T.SQUARE) return "circle";
  const D = CONST.GRID_DIAGONALS;
  if (!D) return "circle";
  switch (grid.diagonals) {
    case D.EQUIDISTANT: return "square";
    case D.RECTILINEAR: return "diamond";
    default:            return "circle";
  }
}
