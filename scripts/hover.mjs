/** case-by-case hover hints. */

import { isInAura }   from "./aura.mjs";
import { getAuraSources } from "./auraRegistry.mjs";

let _layer = null;
const _active = [];

function _TextCls() {
  return foundry.canvas?.containers?.PreciseText ?? globalThis.PreciseText ?? PIXI.Text;
}

/** Get the hover overlay layer. */
function _getLayer() {
  const parent = canvas?.interface ?? canvas?.tokens;
  if (!parent) return null;
  if (!_layer || _layer._destroyed) {
    _layer = new PIXI.Container();
    _layer.eventMode = "none";
  }
  parent.addChild(_layer);   // Keep it on top.
  return _layer;
}

/** Clear all hover hints. */
export function clearAuraHints() {
  for (const g of _active) {
    try { if (!g._destroyed) g.destroy({ children: true }); } catch (_e) { /* already gone */ }
  }
  _active.length = 0;
}

/** Draw hints for the hovered token. */
export function showAuraHints(token) {
  clearAuraHints();
  if (!token?.actor || !canvas?.tokens?.placeables) return;
  const layer = _getLayer();
  if (!layer) return;

  const from = token.center;
  const fontSize = Math.max(12, Math.round((canvas.dimensions?.size ?? 100) * 0.16));

  // Use the cached source list.
  for (const { token: sourceToken, auras: sourceAuras } of getAuraSources()) {
    // Players should not see GM-hidden tokens.
    if (sourceToken.document.hidden && !game.user.isGM) continue;

    const auras = [];
    for (const bonus of sourceAuras) {
      if (!isInAura(sourceToken, token, bonus.aura)) continue;
      auras.push({ name: bonus.name || "Aura", color: bonus.aura.color ?? "#4a90d9" });
    }
    if (!auras.length) continue;

    if (sourceToken !== token) _drawTether(layer, from, sourceToken.center, auras[0].color);
    _drawLabels(layer, sourceToken, auras, fontSize);
  }
}

// ---------------------------------------------------------------------------

function _drawTether(layer, from, to, color) {
  const hex = foundry.utils.Color.from(color);
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.min(50, len * 0.14);               // Slight bow.
  const cx = (from.x + to.x) / 2 - (dy / len) * off;
  const cy = (from.y + to.y) / 2 + (dx / len) * off;

  const g = new PIXI.Graphics();
  // Outer glow.
  g.lineStyle({ width: 4, color: hex, alpha: 0.16, cap: "round", join: "round" });
  g.moveTo(from.x, from.y); g.quadraticCurveTo(cx, cy, to.x, to.y);
  // Bright core.
  g.lineStyle({ width: 1.5, color: hex, alpha: 0.6, cap: "round" });
  g.moveTo(from.x, from.y); g.quadraticCurveTo(cx, cy, to.x, to.y);
  g.blendMode = PIXI.BLEND_MODES.ADD;

  layer.addChild(g);
  _active.push(g);
}

function _drawLabels(layer, sourceToken, auras, fontSize) {
  const Cls = _TextCls();
  const cx = sourceToken.center.x;
  let y = sourceToken.y - 2;                            // Just above the token's top edge.

  for (let i = auras.length - 1; i >= 0; i--) {         // Stack upward; the first name ends up highest.
    const a = auras[i];
    const t = new Cls(a.name, {
      fontFamily: "Signika, sans-serif",
      fontSize,
      fontWeight: "bold",
      fill: a.color,
      stroke: "#000000",
      strokeThickness: Math.max(3, Math.round(fontSize / 4)),
      align: "center",
    });
    t.anchor.set(0.5, 1);
    t.position.set(cx, y);
    layer.addChild(t);
    _active.push(t);
    y -= (t.height + 1);
  }
}
