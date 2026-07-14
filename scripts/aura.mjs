/** case-by-case aura helpers. */

/** Measure token distance, using occupied cells when needed. */
export function getDistance(t1, t2, maxRange = Infinity) {
  if (t1 === t2) return 0;

  // Quick range check before the expensive scan.
  if (Number.isFinite(maxRange)) {
    const r1 = _footprintRect(t1);
    const r2 = _footprintRect(t2);
    const size = canvas.grid?.size ?? 100;
    const gapX = Math.max(0, r1.x0 - r2.x1, r2.x0 - r1.x1) / size;
    const gapY = Math.max(0, r1.y0 - r2.y1, r2.y0 - r1.y1) / size;
    const unitDistance = canvas.scene?.grid?.distance ?? canvas.grid?.distance ?? 5;
    const lowerBound = Math.max(gapX, gapY) * unitDistance;
    if (lowerBound > maxRange) return lowerBound;
  }

  const cells1 = _occupiedCenters(t1);
  const cells2 = _occupiedCenters(t2);

  let min = Infinity;
  for (const p1 of cells1) {
    for (const p2 of cells2) {
      const d = canvas.grid.measurePath([p1, p2], {})?.distance ?? Infinity;
      if (d < min) min = d;
    }
  }
  return min;
}

/** Token footprint rectangle in scene pixels. */
function _footprintRect(token) {
  const size = canvas.grid?.size ?? 100;
  const doc  = token.document;
  const w    = Math.max(1, Math.round(doc?.width ?? 1));
  const h    = Math.max(1, Math.round(doc?.height ?? 1));
  return { x0: doc.x, y0: doc.y, x1: doc.x + w * size, y1: doc.y + h * size };
}

/** Cell centers for a token's footprint. */
function _occupiedCenters(token) {
  const size = canvas.grid?.size ?? 100;
  const doc  = token.document;
  const w    = Math.max(1, Math.round(doc?.width ?? 1));
  const h    = Math.max(1, Math.round(doc?.height ?? 1));
  const elevation = doc?.elevation ?? 0;

  // 1x1 token: just use the center.
  if (w === 1 && h === 1) return [{ ...token.center, elevation }];

  const centers = [];
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      centers.push({ x: doc.x + (i + 0.5) * size, y: doc.y + (j + 0.5) * size, elevation });
    }
  }
  return centers;
}

/** Check whether the target counts as ally, enemy, or any. */
export function matchesDisposition(sourceToken, targetToken, disposition) {
  if (disposition === 0) return true; // any

  const sd = sourceToken.document.disposition;
  const td = targetToken.document.disposition;

  // Treat SECRET as hostile; fold other non-hostile dispositions together.
  const side = (d) => (d === CONST.TOKEN_DISPOSITIONS.HOSTILE || d === CONST.TOKEN_DISPOSITIONS.SECRET) ? -1 : 1;

  if (disposition === 1) {
    // ally: same side.
    return side(sd) === side(td);
  }
  if (disposition === -1) {
    // enemy: opposite side.
    return side(sd) !== side(td);
  }
  return true;
}

/** Check if the token is conscious and still up. */
export function isConscious(token) {
  const actor = token.actor;
  if (!actor) return false;
  // 0 HP still counts as down.
  if ((actor.system?.attributes?.hp?.value ?? 1) <= 0) return false;
  return !actor.statuses.has("dead") && !actor.statuses.has("unconscious");
}

/** Check for any blocked status on the token. */
export function hasBlockedStatus(token, statuses) {
  if (!statuses?.length) return false;
  const actor = token.actor;
  if (!actor) return false;
  return statuses.some(s => actor.statuses.has(s));
}

/** Main aura check: conscious, unblocked, in range, and matching side. */
export function isInAura(sourceToken, targetToken, aura) {
  // Dead source loses self-aura too.
  if (aura.requiresConsciousness && !isConscious(sourceToken)) return false;

  // Blocked status.
  if (hasBlockedStatus(sourceToken, aura.blockedStatuses)) return false;

  // Self-targeting.
  if (sourceToken === targetToken) return !!aura.self;

  // Side check.
  if (!matchesDisposition(sourceToken, targetToken, aura.disposition)) return false;

  // Range check.
  const distance = getDistance(sourceToken, targetToken, aura.range);
  // Debug-only range details.
  try {
    if (game.settings.get("case-by-case", "debug")) {
      console.log("case-by-case | isInAura range check", {
        source: sourceToken.name, target: targetToken.name,
        sourceElevation: sourceToken.document.elevation, targetElevation: targetToken.document.elevation,
        computedDistance: distance, auraRange: aura.range, inRange: distance <= aura.range,
      });
    }
  } catch { /* setting not ready yet */ }
  return distance <= aura.range;
}
