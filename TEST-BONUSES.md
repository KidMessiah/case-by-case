
# Case by Case: Ready-to-Paste Test Bonuses

Each block below is JSON you can copy straight to your clipboard and paste onto any actor via the Bonus Manager's **Paste** button (top of the bonus list). No need to build these by hand in the config UI: copy the block, open Bonus Manager on the target, click Paste, and the bonus appears fully configured with a fresh ID.

Only the fields that matter for each test are set; everything else (aura, filters, etc.) fills in from defaults, so these are intentionally minimal.

**Suggested roster** (same as TEST-PLAN.md):
- **Roller**: your PC, the one making rolls and hosting most "local" bonuses.
- **Ally**: a friendly token, for aura and "affects allies" tests. Keep it within 10ft of the Roller unless a test says otherwise.
- **Foe A**: an NPC of creature type **Undead** (or any type distinct from the other NPC).
- **Foe B**: an NPC of a *different* creature type, used as the "should NOT match" control.
- **Foe C** *(optional, for the crit-doubling/bypass tests)*: an NPC with **Resistance: Bludgeoning (nonmagical)** set on its Damage Resistances, and **Bypasses: Magical** checked.

midi-qol must be active for all Attack/Damage/Crit Range and Foe-filtered tests; those paths don't exist without it.

---

## A. Basic bonus types (native, should show on the character sheet)

**A.1 — Flat saving throw bonus**
```json
{"cb":"bonus","version":1,"bonus":{"name":"A1 Save +2","type":"save","bonus":"2"}}
```
Paste on Roller. Check: appears in the sheet's saving throw bonus; applies to every save.

**A.2 — Flat ability check bonus, one skill only**
```json
{"cb":"bonus","version":1,"bonus":{"name":"A2 Perception +2","type":"skill","bonus":"2","filters":{"skills":["prc"]}}}
```
Paste on Roller. Check: only Perception gets it, no other skill.

**A.3 — Attack roll dice bonus**
```json
{"cb":"bonus","version":1,"bonus":{"name":"A3 Attack +1d4","type":"attack","bonus":"1d4"}}
```
Paste on Roller. Check: shows on sheet; the extra d4 appears in the to-hit roll.

**A.4 — Damage bonus**
```json
{"cb":"bonus","version":1,"bonus":{"name":"A4 Damage +2","type":"damage","bonus":"2"}}
```
Paste on Roller. Check: applies to every damage roll.

**A.5 — Spell Save DC bonus**
```json
{"cb":"bonus","version":1,"bonus":{"name":"A5 Save DC +1","type":"saveDC","bonus":"1"}}
```
Paste on Roller (needs at least one spell). Check: DC shown in the spellcasting panel goes up by 1. Also open this bonus's config: the **Roll** tab should be greyed out (nothing to filter for a flat DC bonus).

**A.6 — Death save bonus**
```json
{"cb":"bonus","version":1,"bonus":{"name":"A6 Death Save +2","type":"death","bonus":"2"}}
```
Paste on Roller. Roll a death save: applies. Roll-time only, no sheet key.

**A.7 — Hit die bonus**
```json
{"cb":"bonus","version":1,"bonus":{"name":"A7 Hit Die +1d4","type":"hitDie","bonus":"1d4"}}
```
Paste on Roller. Roll a hit die: extra 1d4 shows up.

**A.8 — Initiative bonus**
```json
{"cb":"bonus","version":1,"bonus":{"name":"A8 Initiative +2","type":"initiative","bonus":"2"}}
```
Paste on Roller. Roll initiative: applies, and now shows on the sheet's initiative display (native-routed to `system.attributes.init.bonus`, same as A.1/A.2/A.5).

---

## B. Advantage / Disadvantage system (grantsMode, additionalD20, rollKinds)

This is the biggest rework this session touched, so it gets the most coverage.

**B.1 — Plain forced Advantage, all roll kinds**
```json
{"cb":"bonus","version":1,"bonus":{"name":"B1 Advantage (all kinds)","type":"advantage","grantsMode":true}}
```
Paste on Roller. Roll a save, a check, a skill, an attack, a death save, a hit die, and initiative; every one of those seven should come up forced to Advantage (default dnd5e button highlight too).

**B.2 — Forced Advantage restricted to one roll kind**
```json
{"cb":"bonus","version":1,"bonus":{"name":"B2 Advantage (Skill only)","type":"advantage","grantsMode":true,"filters":{"rollKinds":["skill"]}}}
```
Paste on Roller. Roll a skill check (forced Advantage) and then a saving throw (should NOT be forced), confirming **Applies To** actually restricts scope. Also re-test with a skill that's mechanically at disadvantage from something else (e.g. Stealth in heavy armor); it should cancel to Normal, not lose to the disadvantage. (This required a fix: AC5E recomputes advantage/disadvantage from its own condition list on `dnd5e.buildRollConfig` and was silently dropping case-by-case's contribution whenever AC5E also had one to report, so case-by-case now re-asserts its own grant after AC5E runs.)

**B.3 — Dice-only Advantage, does NOT grant on its own**
```json
{"cb":"bonus","version":1,"bonus":{"name":"B3 Adv Dice-Only (Skill)","type":"advantage","grantsMode":false,"additionalD20":"1","filters":{"rollKinds":["skill"]}}}
```
Paste on Roller. Roll a skill check at **Normal**: should stay Normal, no extra dice (this bonus grants nothing by itself). Now roll the same skill check and manually pick **Advantage** in the roll dialog: this time you should see 3d20 (2 normal + 1 extra from this bonus), keep-highest. This is the core "grants a toggle to grant, dice only apply if the mode happens anyway" behavior, the whole point of `grantsMode`.

**B.4 — Forced Disadvantage, all roll kinds**
```json
{"cb":"bonus","version":1,"bonus":{"name":"B4 Disadvantage (all kinds)","type":"disadvantage","grantsMode":true}}
```
Paste on Roller. Same sweep as B.1, expecting Disadvantage instead.

**B.5 — Cancellation test (the double-apply/order-dependence bug fix)**
Paste **both** of these on Roller at once:
```json
{"cb":"bonus","version":1,"bonus":{"name":"B5a Advantage (Save)","type":"advantage","grantsMode":true,"filters":{"rollKinds":["save"]}}}
```
```json
{"cb":"bonus","version":1,"bonus":{"name":"B5b Disadvantage (Save)","type":"disadvantage","grantsMode":true,"filters":{"rollKinds":["save"]}}}
```
Roll a saving throw. Expected: **Normal**, not Advantage and not Disadvantage: one of each cancels out regardless of which was scanned first. This is the exact bug that used to defeat cancellation (an Advantage bonus with extra dice would force the roll back to Advantage even after a proper Normal cancellation).

**B.6 — Same-roll double-apply check (native + roll-time must not double-count)**
```json
{"cb":"bonus","version":1,"bonus":{"name":"B6 Advantage+Dice (Save+Check)","type":"advantage","grantsMode":true,"additionalD20":"1","filters":{"rollKinds":["save","check"]}}}
```
Paste on Roller alongside B4 (Disadvantage, all kinds) still active. Roll a saving throw. Expected: **Normal** (B6's advantage and B4's disadvantage on saves/checks cancel at prep time, correctly, with no leftover forced-Advantage from a stale double-apply), but the roll should still be eligible for B6's extra die IF it ends up at Advantage from some other source. Remove B4 before moving on.

**B.7 — Combo bonus on Attack (never native, always roll-time)**
```json
{"cb":"bonus","version":1,"bonus":{"name":"B7 Advantage+Dice (Attack)","type":"advantage","grantsMode":true,"additionalD20":"2","filters":{"rollKinds":["attack"]}}}
```
Paste on Roller. Roll an attack: forced Advantage, 4d20 total (2 base + 2 extra), keep-highest. Attack has no native sheet key, so this always resolves at roll time, a good contrast case against B.6.

**B.8 — Aura granting dice only when already at Advantage (no grant)**
```json
{"cb":"bonus","version":1,"bonus":{"name":"B8 Aura Adv Dice-Only","type":"advantage","grantsMode":false,"additionalD20":"1","filters":{"rollKinds":["skill","save"]},"aura":{"enabled":true,"range":10,"disposition":1,"self":true}}}
```
Paste on Roller (or Ally). Have the Ally (within 10ft) roll a skill check at Normal: no effect. Manually set the Ally's roll to Advantage in the dialog: the aura's extra die should show up (3d20kh). This is the "aura that boosts existing advantage without granting it" use case `grantsMode` was built for.

---

## C. Aura bonuses

**C.1 — Ally buff aura**
```json
{"cb":"bonus","version":1,"bonus":{"name":"C1 Aura Attack +2 (Allies)","type":"attack","bonus":"2","aura":{"enabled":true,"range":10,"disposition":1,"self":true}}}
```
Paste on Roller. Roller and Ally (within 10ft) get it; Foe A/B don't; an ally past 10ft doesn't.

**C.2 — Enemy debuff aura (documents the neutral/hostile-ally behavior)**
```json
{"cb":"bonus","version":1,"bonus":{"name":"C2 Aura Save -2 (Enemies)","type":"save","bonus":"-2","aura":{"enabled":true,"range":15,"disposition":-1,"self":false}}}
```
Paste on a **Friendly**-disposition token. Check: it debuffs Hostile-disposition tokens in range. Then place a **Neutral**-disposition token in range too and check it: per the documented behavior, a friendly source's "Enemies" aura also reaches Neutral/Secret tokens (they count as the opposite side from a non-hostile source), so the neutral token should ALSO be debuffed. This isn't a bug; see the hint text on the aura's "Affects" field in the config UI.

**C.3 — Everyone aura**
```json
{"cb":"bonus","version":1,"bonus":{"name":"C3 Aura Check +1 (Everyone)","type":"check","bonus":"1","aura":{"enabled":true,"range":10,"disposition":0,"self":true}}}
```
Applies regardless of disposition; check it hits Roller, Ally, and both Foes if all are in range.

**C.4 — Consciousness + blocked status**
```json
{"cb":"bonus","version":1,"bonus":{"name":"C4 Aura Requires Conscious","type":"attack","bonus":"2","aura":{"enabled":true,"range":10,"disposition":1,"self":true,"requiresConsciousness":true,"blockedStatuses":["silenced"]}}}
```
Paste on Roller. Confirm it works normally, then knock Roller unconscious (0 HP): aura should stop projecting entirely, including to itself. Revive, then apply the Silenced status instead: same result.

**C.5 — Self = off**
```json
{"cb":"bonus","version":1,"bonus":{"name":"C5 Aura Self Off","type":"attack","bonus":"2","aura":{"enabled":true,"range":10,"disposition":1,"self":false}}}
```
Paste on Roller. Roller should NOT get the bonus on its own attack, but Ally (in range) should.

**C.6 — Duplicate aura-source id test (this session's dialog-collision fix)**
Paste this **optional** aura bonus onto **two separate tokens of the same actor** (e.g. duplicate an NPC, or place two tokens of one linked "party" actor) so both are in range of the Roller at once:
```json
{"cb":"bonus","version":1,"bonus":{"name":"C6 Optional Aura Damage +1d6","type":"damage","bonus":"1d6","optional":true,"aura":{"enabled":true,"range":15,"disposition":0,"self":false}}}
```
Roll damage from the Roller with both sources in range: the optional dialog should show **two separate rows** (one per source token) and checking either (or both) should actually apply. Before this session's fix, two same-bonus-id rows collided into one broken checkbox and neither applied even when checked.

---

## D. Foe (Target) filters, Attack / Damage / Crit Range only

**D.1 — Creature type filter**
```json
{"cb":"bonus","version":1,"bonus":{"name":"D1 vs Undead +2 Attack","type":"attack","bonus":"2","filters":{"foeTypes":["undead"]}}}
```
Paste on Roller. Attack Foe A (Undead): applies. Attack Foe B (not Undead): doesn't.

**D.2 — Condition filter**
```json
{"cb":"bonus","version":1,"bonus":{"name":"D2 vs Prone +1d6 Damage","type":"damage","bonus":"1d6","filters":{"foeConditions":["prone"]}}}
```
Paste on Roller. Damage a prone target: applies. Damage a standing target: doesn't.

**D.3 — HP Threshold filter (a configurable % HP threshold, not a fixed 50%)**
```json
{"cb":"bonus","version":1,"bonus":{"name":"D3 vs Bloodied +1d6","type":"damage","bonus":"1d6","filters":{"foeBloodied":50}}}
```
Test against a target above half HP (no bonus) and at/below half HP (bonus applies). In BonusConfig's Foe tab, the "HP Threshold" filter is a percentage field (default 50, but any 0-100 value works) rather than a plain on/off toggle — try changing it to e.g. `25` and confirm the bonus now only applies at or below a QUARTER of the target's max HP, not half.

**D.4 — Within-range filter (validates the perf early-exit didn't break correctness)**
```json
{"cb":"bonus","version":1,"bonus":{"name":"D4 vs Within 10ft +1 Attack","type":"attack","bonus":"1","filters":{"foeWithin":10}}}
```
Attack from 5ft (applies) and from 15ft (doesn't). Also worth trying with a Huge/Gargantuan-sized attacker or target if you have one, to sanity-check the footprint-based distance math still measures edge-to-edge correctly.

**D.5 — Crit range vs a condition**
```json
{"cb":"bonus","version":1,"bonus":{"name":"D5 Crit 19+ vs Prone","type":"critRange","bonus":"19","filters":{"foeConditions":["prone"]}}}
```
Attack a prone target repeatedly: crits on 19-20. Attack a standing target: crits on 20 only.

**D.6 — Foe damage: crit doubling + resistance bypass (this session's fix)**
```json
{"cb":"bonus","version":1,"bonus":{"name":"D6 vs Foe C +2d6 Fire","type":"damage","bonus":"2d6","filters":{"damageTypes":["fire"]}}}
```
This one has no foe filter itself; pair it with a foe-filtered version instead for the real test:
```json
{"cb":"bonus","version":1,"bonus":{"name":"D6b vs Foe C +2d6 Bludgeoning","type":"damage","bonus":"2d6","filters":{"foeTypes":["construct"]}}}
```
Paste D6b on Roller, target **Foe C** (set up with Resistance: Bludgeoning nonmagical + Bypasses: Magical, per the roster note). Attack with a **nonmagical** weapon: the bonus damage should come out **halved** (resistance applies). Attack with a **magical** weapon (the "mgc" property): the bonus damage should NOT be halved (bypass recognized). Then land a **critical hit** with the magical weapon: the bonus damage should be **doubled** on top of that. This exercises both fixes at once, bypass detection and crit doubling, on the separate per-target foe-damage roll (not the main damage roll, which dnd5e already handles correctly on its own).

**D.7 — Foe filter via aura, on an AoE hitting mixed targets**
```json
{"cb":"bonus","version":1,"bonus":{"name":"D7 Aura vs Undead +2d6 (AoE-safe)","type":"damage","bonus":"2d6","filters":{"foeTypes":["undead"]},"aura":{"enabled":true,"range":30,"disposition":0,"self":false}}}
```
Paste on Ally. Roller casts an AoE (e.g. Fireball) hitting both Foe A (Undead) and Foe B at once. Check: the bonus damage lands only on Foe A's share, not uniformly on everyone hit.

**D.8 — Optional foe-filtered damage bonus**
```json
{"cb":"bonus","version":1,"bonus":{"name":"D8 Optional vs Undead +1d8","type":"damage","bonus":"1d8","optional":true,"filters":{"foeTypes":["undead"]}}}
```
Target Foe A and roll damage: dialog offers it, tagged "vs. target." Target Foe B instead: dialog doesn't offer it at all.

**D.9 — Has Effect (by Name) filter, foe side**
```json
{"cb":"bonus","version":1,"bonus":{"name":"D9 vs Blessed Foe +1d6","type":"damage","bonus":"1d6","filters":{"foeEffectName":"Bless"}}}
```
Apply an effect named "Bless" (or anything containing that text, case-insensitive) to the target, then attack: bonus applies. Remove the effect: it doesn't. In BonusConfig's Foe tab, this is "Has Effect (by Name)" with a text field plus a "Must Be Active" toggle; with it on (the default), disable the target's Bless effect (don't remove it, just toggle it off on the target's Effects tab) and confirm the bonus stops applying. Turn "Must Be Active" off and re-test: the bonus should now apply even while that effect is disabled.

---

## E. Item / Spell filters

**E.1 — Item type filter (and the "no item" pass-through fix)**
```json
{"cb":"bonus","version":1,"bonus":{"name":"E1 Weapon-only +1 Attack","type":"attack","bonus":"1","filters":{"itemTypes":["weapon"]}}}
```
Attack with a weapon: applies. Attack with a spell instead (a non-weapon item): should NOT apply. Before this session's fix, a roll with no matching item type could slip through instead of being correctly rejected.

**E.2 — Spell school filter (and the same pass-through fix)**
```json
{"cb":"bonus","version":1,"bonus":{"name":"E2 Evocation-only +1d6 Damage","type":"damage","bonus":"1d6","filters":{"spellSchools":["evo"]}}}
```
Cast an Evocation spell: applies. Attack with a mundane weapon (no spell school at all): should NOT apply.

**E.3 — Spell level filter**
```json
{"cb":"bonus","version":1,"bonus":{"name":"E3 Level 3+ Spells +1d4","type":"damage","bonus":"1d4","filters":{"minSpellLevel":3}}}
```
Cast a 3rd-level+ spell: applies. Cast a cantrip or 1st/2nd level spell: doesn't. Attack with a weapon (no spell level at all): should NOT apply either.

**E.4 — Attack mode filter**
```json
{"cb":"bonus","version":1,"bonus":{"name":"E4 Melee-only +1 Attack","type":"attack","bonus":"1","filters":{"attackModes":["mwak"]}}}
```
Melee weapon attack: applies. Ranged or spell attack: doesn't.

**E.5 — Damage type filter**
```json
{"cb":"bonus","version":1,"bonus":{"name":"E5 Fire-only +1d6","type":"damage","bonus":"1d6","filters":{"damageTypes":["fire"]}}}
```
Deal fire damage: applies. Deal any other type: doesn't.

**E.6 — Weapon property / spell component filter**
Paste this bare, then open it in the config UI and pick one option in the "Applies To" (Item & Spell tab) picker yourself; the exact internal key for weapon properties/spell components isn't worth hand-typing blind:
```json
{"cb":"bonus","version":1,"bonus":{"name":"E6 Property-filtered +1d4","type":"damage","bonus":"1d4"}}
```
After picking e.g. "Finesse" (weapon) or "Concentration" (spell): confirm it only applies to items with that property.

**E.7 — `@scaling` in a formula (spell-level scaling, this session's feature)**
```json
{"cb":"bonus","version":1,"bonus":{"name":"E7 Scaling Damage","type":"damage","bonus":"(1 + @scaling.increase)d6"}}
```
Paste on Roller (local, not aura). Cast a scalable spell at its base level: applies as `1d6`. Cast the SAME spell upcast by 2 slot levels: applies as `3d6`. `@scaling.increase` is dnd5e's own native "levels above baseline" value (0 at base); `@scaling.value` (1-based, same value dnd5e's own scaling formulas use) works the same way, e.g. `(@scaling.value)d6`. Also test this as an AURA bonus (`"aura":{"enabled":true,"range":15,...}`) granted by a second token onto the Roller: `@scaling` should still reflect the ROLLER's cast level, not the aura source's, while `@mod`-style refs (if any) still resolve against the aura source.
*(Corrected after a live test: this originally read `{1 + @scaling.increase}d6` with curly braces; see section M's note for why that's wrong and silently eats the dice.)*

---

## F. Stacking tags (dedup)

**F.1 — Numeric stacking: only the larger wins**
```json
{"cb":"bonus","version":1,"bonus":{"name":"F1a Blessed +2 Attack","type":"attack","bonus":"2","stackTag":"blessed"}}
```
```json
{"cb":"bonus","version":1,"bonus":{"name":"F1b Blessed +4 Attack","type":"attack","bonus":"4","stackTag":"blessed"}}
```
Paste both on Roller. Attack: only **+4** applies, not +6. Two different tags (or blank) would both stack; try changing one tag and confirming both apply.

**F.2 — The d20-control-survives-losing-the-tag fix**
```json
{"cb":"bonus","version":1,"bonus":{"name":"F2a Tagged +2 Attack","type":"attack","bonus":"2","stackTag":"warlord"}}
```
```json
{"cb":"bonus","version":1,"bonus":{"name":"F2b Tagged Advantage+Dice, no flat bonus","type":"advantage","grantsMode":true,"bonus":"0","additionalD20":"1","stackTag":"warlord","filters":{"rollKinds":["attack"]}}}
```
Paste both on Roller. Attack roll: expect **+2** to hit (F2a wins the flat-formula comparison, since F2b's formula is forced to "0") **AND** the roll forced to Advantage with an extra die (3d20kh) from F2b. Before this session's fix, F2b losing the tag comparison would have silently dropped its advantage/dice too; this confirms d20 control now survives independently of which bonus "wins" the tag.

---

## G. Multipart groups

**G.1 — "Great Weapon Master"-style, optional, timing before attack**
```json
{"cb":"bonus","version":1,"bonus":{"name":"G1 GWM-style","kind":"multipart","optional":true,"promptTiming":"attack","children":[{"id":"a","name":"Attack Penalty","type":"attack","bonus":"-5"},{"id":"b","name":"Damage Bonus","type":"damage","bonus":"10"}]}}
```
Paste on Roller. Roll attack: prompted once. Accept: -5 applies to the attack immediately and +10 carries automatically to the following damage roll with no second prompt. Decline: neither applies.

**G.2 — Non-optional (mandatory) group**
```json
{"cb":"bonus","version":1,"bonus":{"name":"G2 Mandatory Combo","kind":"multipart","optional":false,"children":[{"id":"a","name":"Attack Part","type":"attack","bonus":"1"},{"id":"b","name":"Damage Part","type":"damage","bonus":"1d4"}]}}
```
Both children apply automatically to their respective rolls, no prompt at all.

**G.3 — Foe-filtered multipart group**
```json
{"cb":"bonus","version":1,"bonus":{"name":"G3 vs Undead Combo","kind":"multipart","optional":false,"filters":{"foeTypes":["undead"]},"children":[{"id":"a","name":"Damage Part","type":"damage","bonus":"2d8"},{"id":"b","name":"Crit Part","type":"critRange","bonus":"19"}]}}
```
Roll vs. Foe A (Undead): both children apply automatically. Roll vs. Foe B: neither applies.

---

## H. Crit Range (including the new optional consumer)

**H.1 — Required crit range**
```json
{"cb":"bonus","version":1,"bonus":{"name":"H1 Crit on 18+","type":"critRange","bonus":"18"}}
```
Attacks crit on 18-20 instead of just 20.

**H.2 — Crit range formula with an `@ref` (this session's silent-failure fix)**
```json
{"cb":"bonus","version":1,"bonus":{"name":"H2 Crit Formula @ref","type":"critRange","bonus":"20 - @prof"}}
```
Paste on Roller. This used to throw silently and get dropped with no warning if the actor's proficiency bonus made the formula non-trivial. Confirm it now correctly resolves (check console: no error, and the threshold reflects `20 - proficiency bonus`).

**H.3 — Optional local crit range (brand new consumer, was a total no-op before)**
```json
{"cb":"bonus","version":1,"bonus":{"name":"H3 Optional Crit on 15+","type":"critRange","bonus":"15","optional":true}}
```
Paste on Roller. Roll an attack: the pre-roll dialog should now show a **"crit on 15+"** row alongside any other optional bonuses. Check it: crits on 15-20 for that attack. Leave it unchecked: normal crit range. Before this session, this checkbox didn't exist at all and the bonus silently never worked no matter what.

**H.4 — Optional foe-filtered crit range**
```json
{"cb":"bonus","version":1,"bonus":{"name":"H4 Optional Crit 17+ vs Undead","type":"critRange","bonus":"17","optional":true,"filters":{"foeTypes":["undead"]}}}
```
Target Foe A (Undead) and attack: offered, tagged "vs. target." Target Foe B: not offered.

---

## I. Comparison filter (native-routing timing fix)

**I.1 — Comparison against a DERIVED value, on a bonus that would otherwise be native-routed**
```json
{"cb":"bonus","version":1,"bonus":{"name":"I1 Save +2 if CHA mod >= 3","type":"save","bonus":"2","filters":{"comparison":"@abilities.cha.mod >= 3"}}}
```
Paste on an actor whose CHA modifier is +3 or higher. Save: bonus applies. Lower the actor's CHA (or test on a different actor with a lower mod): bonus doesn't apply. This specifically exercises a DERIVED value (ability modifier, computed during `prepareDerivedData`). Before this session's fix, a comparison like this on a bonus that would otherwise qualify for native (sheet-level) routing could read stale/undefined data because it was evaluated before derived data existed that prep cycle. The fix routes any comparison-filtered bonus off the native path entirely, so it's evaluated fresh at roll time instead.

**I.2 — Comparison against source data (sanity control)**
```json
{"cb":"bonus","version":1,"bonus":{"name":"I2 Save +2 if HP <= half","type":"save","bonus":"2","filters":{"comparison":"@attributes.hp.value <= @attributes.hp.max / 2"}}}
```
This one uses source data (current/max HP), which always worked correctly; just confirm it still does, as a control against I.1.

---

## J. "This Item Only" (scopeToHostItem)

**J.1 — Scoped to one specific weapon**
Paste this directly onto a specific weapon Item (not the Actor); open that weapon's own bonus manager (or use the Actor's manager and move it to the item if your build supports drag targeting, otherwise create it via the item sheet's own Case by Case button):
```json
{"cb":"bonus","version":1,"bonus":{"name":"J1 This-Weapon-Only +1 Attack","type":"attack","bonus":"1","scopeToHostItem":true}}
```
Attack with that exact weapon: applies. Attack with a different, otherwise-identical weapon on the same actor: does NOT apply.

---

## K. Cross-session regression scenarios (setup + procedure, not single bonuses)

**K.1 — activity.uuid stash collision (cancelled use shouldn't leak into the next)**
Use bonus **G.1** (optional GWM-style multipart). Roll the attack, get the optional dialog, and **decline**/close it without choosing. Immediately make a **second, independent** attack with the *same weapon/activity*. Confirm the second attack is NOT carrying any stale "accepted" children from the first, cancelled roll.

**K.2 — Overlapping uses of the same activity**
If you can trigger two uses of the same activity in quick succession (e.g. two clones of the same NPC using the identical attack action back to back, or a Haste-granted extra attack action fired immediately), confirm each roll's optional dialog and carried bonuses stay independent; one shouldn't overwrite or wipe the other's pending state.

**K.3 — Cross-actor race**
While one actor's optional-bonus dialog is open and NOT yet answered (leave it sitting on screen), have a **different actor** make a roll of the same type (e.g. both roll a save). Confirm the second actor's roll gets its own bonuses correctly and doesn't accidentally consume/steal the first actor's still-pending injection (or vice versa).

---

## L. Debug logging setting

Open **Settings → Configure Settings → Module Settings → Case by Case** and confirm a **"Debug logging"** checkbox exists, off by default. With it off, make a handful of normal rolls (including some with no case-by-case bonuses involved at all) and confirm the console stays quiet. Turn it on and confirm the diagnostic `case-by-case | ...` log lines reappear.

---

## M. Formula syntax: roll-data references (`@refs` in a bonus formula)

**Two UI aids exist now so you don't have to memorize any of this by hand:** a live **"Resolves to: X"** line appears under the Bonus Formula field as you type, showing exactly what the formula evaluates to (e.g. typing `(@item.level*2)d6` on a 5th-level cast shows `Resolves to: 10d6`). No dice are rolled, it's parse-only, so it's safe to leave on while you experiment. And a small wand-icon **"Insert scaling..."** button next to the field offers the patterns in M.1–M.3/M.5 below as ready-made, correctly-parenthesized text you can drop in and tweak, instead of typing them from scratch.

A bonus's `bonus` field isn't limited to flat numbers/dice; it can reference the rolling actor's (or, for a spell/item bonus, the rolled item's) live roll data, the same way dnd5e's own weapon and feature formulas do. Two syntax rules apply everywhere below, local or aura:

- **Parentheses (not curly braces) are required when a reference, or any compound expression, is immediately followed by a die size**, e.g. `(@prof)d6` or `(@item.level*2)d6`, not `@profd6` or `{@prof}d6`. Confirmed via a live bug report: `{3 * 2}d6` (curly braces) evaluated the `3 * 2` group to a flat `6` and then silently DROPPED the trailing `d6` entirely; the roll showed `8d6 + {3 * 2}d6` with an unexplained flat +6 added to the total and no extra dice in the breakdown. Curly braces are Foundry's *Pool* syntax (for bundling multiple comma-separated sub-rolls with keep/drop modifiers, e.g. `{4d6,2d8}kh`), not a general "evaluate this, then use it as a dice count" wrapper; only a plain parenthetical `(...)` does that. A bare reference used as a flat number with nothing rolled off it (e.g. `@details.level` on its own) needs no wrapping at all; parentheses (and definitely not braces) are only needed right before a die size.
- **Local (self) bonuses and aura/foe/optional/saveDC bonuses use identical syntax**, just resolved at different times: local bonuses get appended as a raw formula term and resolved later by dnd5e's own roll construction (which already has full roll data for whichever item/actor is rolling); aura/foe/optional/saveDC bonuses get resolved immediately by case-by-case against the bonus's own source actor, plus (as of this session) the currently-rolled item's `@scaling`/`@item` data layered on top. Either way, the same `@ref` spellings work.

**M.1 — `(@item.level)d6`: dice scaled to the actual spell level cast**
```json
{"cb":"bonus","version":1,"bonus":{"name":"M1 Actual-Level Scaling +Xd6","type":"damage","bonus":"(@item.level)d6"}}
```
Paste on Roller. Cast a 1st-level spell at 1st level: `1d6`. Upcast the same spell to 3rd level: `3d6`. A naturally 3rd-level spell (e.g. Fireball) cast at base: `3d6`; upcast to 5th: `5d6`. Works because `SpellData#getRollData()` bakes the upcast increase directly into `item.level`, no addition needed. Also test this as an aura bonus granted from a second token: `@item.level` should still reflect the ROLLER's cast level, not anything about the granter.

Careful with `@item.level` specifically: it's the spell's *absolute* cast level, not levels-above-baseline. If a spell already has its own native upcast scaling (e.g. Fireball's own "+1d6 per slot above 3rd"), adding a SEPARATE bonus keyed off `@item.level` stacks on top of that: you'll get extra dice even at base level (never zero), and the two scaling effects compound further under upcasting. Use M.2's `@scaling.increase` instead when you want dice that layer cleanly on top of a spell's own built-in scaling.

**M.2 — `(@scaling.increase)`/`(@scaling.value)`: levels *above baseline*, not the absolute level**
```json
{"cb":"bonus","version":1,"bonus":{"name":"M2 Per-Upcast-Level +1d6","type":"damage","bonus":"(1 + @scaling.increase)d6"}}
```
Same setup as E.7, included here again for contrast with M.1. Cast at the spell's minimum level: `1d6` (`@scaling.increase` = 0). Each level upcast beyond that adds one more d6, regardless of the spell's own base level. Use this when a feature should scale off "how many slots above the minimum," not the absolute spell level (e.g. Empowered Evocation-style riders); use M.1 when it should scale off the actual level cast.

**M.3 — Proficiency bonus as a dice count**
```json
{"cb":"bonus","version":1,"bonus":{"name":"M3 Prof-Scaled Damage","type":"damage","bonus":"(@prof)d6"}}
```
Dice count equals current proficiency bonus (2 at level 1-4, 3 at 5-8, etc.).

**M.4 — Ability modifier in a formula**
```json
{"cb":"bonus","version":1,"bonus":{"name":"M4 Int-Mod Bonus Damage","type":"damage","bonus":"@abilities.int.mod"}}
```
Swap `int` for any ability key (`str`, `dex`, `con`, `wis`, `cha`). `.value` gives the raw score instead of the modifier; `.save.value` gives that ability's total save bonus. No wrapping needed here; nothing follows it that could be misread as part of the reference name.

**M.5 — Character level as a flat scaling number**
```json
{"cb":"bonus","version":1,"bonus":{"name":"M5 Level-Scaled Damage","type":"damage","bonus":"@details.level"}}
```
Total character level (sum of all class levels), Character actors only, not NPCs.

**Other verified references, for building your own formulas (not exhaustively tested here):**
- `@attributes.spell.dc` / `.attack` / `.mod`: the character's actual spellcasting DC, spell attack bonus, and spellcasting ability modifier.
- `@attributes.hp.value` / `.max`, `@attributes.ac.value`, `@attributes.init.mod`, `@attributes.movement.walk`: the usual derived attributes, same paths as the character sheet.
- `@resources.primary.value` / `.max` (also `secondary`/`tertiary`): a Character's custom resource trackers, if the player uses one for a homebrew mechanic.
- `@scale.<class-identifier>.<key>`: Advancement-driven Scale Values (e.g. a Rogue's Sneak Attack dice, a Monk's Martial Arts die). The exact identifier/key depends on that class's advancement config; check an existing feature's own damage formula on the class item for the precise path before relying on it blind.
- `@item.<field>`: anything else on the rolled item's own system data (only meaningful for item-tied bonuses; aura bonuses still get this from whatever item the RECIPIENT is rolling, not the granter's own item).

Formulas referencing an `@ref` that doesn't resolve (typo, wrong actor type, etc.) fail silently into `0` or get skipped; see the note below on checking the console with Debug logging on.

---

## N. Healing & Temporary HP bonus types (this session's feature)

dnd5e's Heal activities (Cure Wounds, Healing Word, False Life, Aid, ...) fire through the exact same roll pipeline a Damage activity uses, confirmed via dnd5e's actual source: `HealActivity`'s `rollHealing()` action just calls `this.rollDamage(...)`, the identical entry point a real Damage activity uses. Case by Case previously had no way to tell them apart, so a "Damage Roll" bonus with no filters silently ALSO buffed healing. **Healing Roll** and **Temporary HP Roll** are now their own first-class Bonus Types, distinguished from each other via the specific Heal activity's own `healing.types` field (dnd5e's own healing-vs-temp-HP vocabulary); they never leak into a Damage Roll bonus, or into each other.

**N.1 — Flat Healing Roll bonus, local**
```json
{"cb":"bonus","version":1,"bonus":{"name":"N1 Healing +1d4","type":"heal","bonus":"1d4"}}
```
Paste on Roller. Cast a spell/feature whose Heal activity is configured for **Healing** (e.g. Cure Wounds, Healing Word): the extra 1d4 applies. Cast a Damage-type spell (e.g. Fire Bolt) or a Temp-HP source (below): does NOT apply. Confirms Healing, Damage, and Temp HP no longer share one bucket.

**N.2 — Flat Temporary HP Roll bonus, local**
```json
{"cb":"bonus","version":1,"bonus":{"name":"N2 Temp HP +2","type":"temphp","bonus":"2"}}
```
Paste on Roller. Cast a spell/feature whose Heal activity is configured for **Temporary HP** (e.g. False Life, Aid): applies. Cast a regular Healing spell (Cure Wounds): does NOT apply.

**N.3 — Aura Healing bonus**
```json
{"cb":"bonus","version":1,"bonus":{"name":"N3 Healing Aura +2","type":"heal","bonus":"2","aura":{"enabled":true,"range":30,"disposition":1}}}
```
Paste on a second token within 30ft of Roller (disposition Allies). Roller casts a Healing spell: +2 applies from the aura source, same as any other aura bonus.

**N.4 — Target (recipient) filter on a Healing bonus**
```json
{"cb":"bonus","version":1,"bonus":{"name":"N4 Healing +1d6 if Recipient Bloodied","type":"heal","bonus":"1d6","filters":{"targetBloodied":50}}}
```
Paste on Ally. Cast a Healing spell that affects Ally while Ally is at or below half HP: +1d6 applies. Heal Ally back above half HP first and repeat: doesn't apply. This is a **Target** filter (Target tab's dedicated "HP Threshold" percentage field, State fieldset), checked against whoever RECEIVES the bonus, no targeting required (see section I for the same mechanism on other types). The old way to express this, a raw `comparison` expression (`"@attributes.hp.value <= @attributes.hp.max / 2"`), still works too and is still the right tool for anything the dedicated HP Threshold field can't express (a non-HP condition, a different comparator, etc.) — try both and confirm they produce the same result at the 50% threshold.

**N.5 — Foe (targeting) filter on a Healing bonus**
```json
{"cb":"bonus","version":1,"bonus":{"name":"N5 Healing +1d6 vs Bloodied Target","type":"heal","bonus":"1d6","filters":{"foeBloodied":50}}}
```
Paste on Roller. Target a bloodied ally and cast a Healing spell at them: +1d6 posts as its own chat roll and merges into their healing, the same way a foe-filtered Damage bonus posts and merges (see section D). Target a full-health ally instead: doesn't apply.

*Unverified, first thing to check if this misbehaves:* foe-filtered Healing/Temp HP bonuses reuse the exact same per-target engine (tied to midi-qol's damage-workflow hooks: `midi-qol.preDamageRollComplete` / `midi-qol.preTargetDamageApplication`) that foe-filtered Damage bonuses use, generalized this session to also carry heal/temphp entries. Resistance/vulnerability/immunity and crit-doubling are deliberately skipped for these (heals can't crit; elemental resistances don't apply to healing). This is a reasoned bet based on dnd5e's actual source (HealActivity funnels through the identical workflow pipeline Damage does) rather than something directly observed live. Test this one particularly on a multi-target heal (e.g. Mass Cure Wounds) if you have one available, and report back if the bonus doesn't land on the right targets.

**N.6 — Item/Spell filters apply to Healing too**
```json
{"cb":"bonus","version":1,"bonus":{"name":"N6 Healing +2, 1st-3rd Level Only","type":"heal","bonus":"2","filters":{"minSpellLevel":1,"maxSpellLevel":3}}}
```
Paste on Roller. Cast a 1st-3rd level healing spell: applies. Upcast it to 4th+, or cast a healing feature with no spell level at all: doesn't. Item Types / Spell Schools / Spell Components / Spell Level all apply to Healing/Temp HP the same way they do for Damage.

**What's deliberately excluded:** Weapon Properties and Damage Types filters aren't offered for Healing/Temp HP bonuses (a weapon's properties and a spell's elemental damage type have no healing equivalent), and the Roll tab's Abilities/Skills/"Applies To" (attack-mode) filters aren't offered either (a healing roll isn't an attack roll). "This Item Only" (scopeToHostItem) and multipart sub-bonuses of type Healing/Temp HP both work the same way Damage's already did.

**N.7 — Has Effect (by Name) filter, recipient side**
```json
{"cb":"bonus","version":1,"bonus":{"name":"N7 +1d6 Damage if Recipient Blessed","type":"damage","bonus":"1d6","filters":{"targetEffectName":"Bless"}}}
```
Paste on Roller (or an ally, for the aura case). Apply an effect named "Bless" to the recipient, then roll damage: bonus applies. Remove it: doesn't. Same "Must Be Active" toggle as D.9's foe-side version, just checked against whoever's RECEIVING the bonus instead of whoever you're rolling against: with it on (default), disabling the recipient's Bless effect (not removing it) should stop the bonus; turning "Must Be Active" off should let a disabled/suppressed effect of that name still count.

---

## O. Resource Consumption (this session's feature)

Lets an **Optional** bonus cost something to accept: Limited Uses on an item, item Quantity, one of the three generic Resource slots, a Spell Slot, Hit Points, Currency, or (as a one-shot) the very Active Effect the bonus lives on. Configured entirely at CONFIGURATION time, on the Details tab: turn the bonus **Optional** on first (locks/greys the whole Consumption section otherwise), then turn on **Consume Resource**, use the two **Resource** dropdowns (first pick a Category: Limited Uses, Item Quantity, Resource, Spell Slot, Hit Points, Currency, This Effect; then the second dropdown repopulates live with the specific resources of that category actually present on that bonus's own actor's sheet), and set a Min/Max amount range. Nothing about WHICH resource is chosen at roll time; only the amount (anywhere in Min–Max) is, via a stepper in the existing Optional-Bonuses dialog. Reference the chosen amount inside the Bonus Formula with `@consumed`.

**Important — accepting means actually clicking "Apply Selected":** each row in the Optional Bonuses dialog is checked by default, but if the dialog is dismissed any other way (Escape, clicking away, closing the window) rather than confirmed with the button, EVERY bonus on it, including consumption ones, is silently treated as declined: nothing applies, nothing is spent, and nothing is logged as an error. This is easy to trigger by accident on a critical hit, where midi-qol tends to stack several confirmation popups in quick succession and it's easy to reflexively dismiss the wrong one. Not a bug, just worth knowing before assuming a consumption bonus "did nothing."

Deduction happens the instant the bonus is **accepted** in that dialog, before the roll itself completes. This mirrors Build-a-Bonus's own documented behavior (uses/slots are "automatically subtracted" as part of confirming the roll) and has the same tradeoff: if the workflow is aborted or errors out after accepting but before the roll posts, the resource is still spent. Tying deduction to "the specific roll's own optional dialog" (attack-type bonuses consume at attack-accept, damage-type at damage-accept) already rules out the worse case: a missed attack whose damage roll never even starts means the damage-type dialog never appears, so nothing is spent for a bonus that never had a chance to apply.

**O.1 — Flat Hit Point cost (no scaling)**

In BonusConfig: Bonus Type "Damage", Bonus Formula `2`, turn **Optional** on (from the bonus list), then on the Details tab turn on **Consume Resource** → Choose Resource → **Hit Points** → set Min `3` Max `3`.

Roll a damage roll on Roller: the Optional Bonuses dialog offers this bonus with **"Costs 3 (fixed)"** instead of a stepper (no range to choose from). Accept it: Roller's current HP drops by 3 immediately, and the +2 damage bonus applies to the roll.

**O.2 — Scaling Currency cost, using `@consumed`**
```json
{"cb":"bonus","version":1,"bonus":{"name":"O2 Gold-Fueled Damage","type":"damage","bonus":"@consumed","optional":true,"consumption":{"enabled":true,"type":"currency","target":"gp","min":1,"max":5}}}
```
Paste on Roller (Roller needs at least 1 gp). Roll damage: the dialog shows a **Spend [_] (1-5)** stepper. Set it to 4 and accept: Roller's gp drops by 4, and the damage bonus is exactly `4` (not a range; `@consumed` was replaced with the literal chosen amount before the formula ever resolves). Set gp below the minimum first and confirm the bonus still gets OFFERED regardless (there's no "can afford it" gate yet, see the note below), but a real shortfall would only surface as `currency.gp` going negative-then-clamped-to-0 by the deduction itself.

**O.3 — Foe-filtered consumption bonus**
```json
{"cb":"bonus","version":1,"bonus":{"name":"O3 Smite the Bloodied","type":"damage","bonus":"(@consumed)d6","optional":true,"filters":{"foeBloodied":50},"consumption":{"enabled":true,"type":"currency","target":"sp","min":1,"max":3}}}
```
Paste on Roller. Target a bloodied enemy and a full-health enemy together, then roll an AoE (or single-target, retargeted) damage roll that hits both. The dialog offers this bonus (only because a current target is bloodied, same `vs. target` tag as any other foe-filtered optional bonus). Accept with amount 2: Roller spends 2 sp exactly ONCE (not once per matching target), rolls `2d6` exactly once, and that same total gets applied only to the bloodied target; the full-health one gets nothing. Confirms foe-filtered consumption follows the existing "roll once, apply to every matching target" rule (see section D) rather than re-rolling or re-charging per target.

**O.4 — Limited Uses / Item Quantity (UI-only, item ids can't be pasted statically)**

Give Roller a feature item with Limited Uses configured (e.g. 2/2), or any physical item with Quantity > 1. Create a new Optional damage (or any type) bonus on Roller, turn on Consume Resource, and set the Category dropdown to **Limited Uses** (or **Item Quantity**): the Resource dropdown repopulates with that item, showing its current `value/max`. Pick it, set Min 1 Max 1, save. Accept the bonus at roll time: the item's uses (or quantity) drops by 1. Re-open the bonus's config afterward: the Resource dropdown should still show that item selected. Delete the item, then re-open the config: since the deleted item no longer shows up in the scan, the Resource dropdown will silently fall back to whatever's now first in that category's list (or "None found on this actor" if nothing else qualifies); there's no explicit "missing" warning, so re-saving at that point will quietly retarget the bonus at a different resource (or an empty target). Worth knowing rather than assuming the old selection is still safely remembered.

**O.5 — Consuming the hosting Effect itself**

Create an Active Effect on Roller, and on that EFFECT (not the actor) add an Optional damage bonus with Consume Resource on, **This Effect** as the resource (only offered when the bonus's own document is an Active Effect), Min/Max both 1. Roll damage and accept: the bonus applies once, and the effect itself is deleted immediately after. Roll again: the bonus (and its effect) are simply gone; nothing left to offer.

**O.6 — Consuming through a critical hit**
```json
{"cb":"bonus","version":1,"bonus":{"name":"O6 Blood Magic","type":"damage","bonus":"(@consumed)d6","optional":true,"consumption":{"enabled":true,"type":"hp","target":"","min":1,"max":10}}}
```
Paste on Roller. Make an attack roll that crits (or force one, e.g. temporarily set a Crit Range bonus to 2), then roll damage. The Optional Bonuses dialog should appear with this row **checked by default** and an amount stepper (1-10). Enter 9 and click **Apply Selected**; don't just close the dialog. Confirm: Roller's HP drops by exactly 9, and the damage roll includes a `9d6` term. Separately worth checking (not a guaranteed pass/fail, just something to observe): whether that injected `9d6` term gets doubled to `18d6` the same way the weapon's own base damage dice do on a crit, or whether it's added post-doubling and stays at `9d6`; this bonus was built purely by pushing a string into the roll's `parts` array before the roll evaluates, not through dnd5e's own "critical bonus dice" config, so there's no explicit guarantee either way. If it turns out bonus dice never double on a crit, that's a real gap to revisit, not expected behavior.

This test exists because of a real mix-up during play: a Blood Magic-style bonus was accepted (9 HP entered) on a crit, but neither the die nor the HP change showed up. Tracing it confirmed the code path was never the problem: the bonus was gathered, the dialog logic ran, and there's no crit-conditional branch anywhere in the consumption pipeline. The likely explanation was the dialog getting dismissed rather than confirmed, in the middle of the extra popups a crit tends to bring up via midi-qol. See the "Important" note near the top of this section.

**What's deliberately excluded:**
- **Aura bonuses**: the Consume Resource toggle is locked (with an explanatory tooltip) the moment Aura is enabled on a bonus. The resource picker scans the bonus's OWN document's actor, which for an aura bonus is the SOURCE (the one granting the aura), but the one who'd need to pay for it, and the one making the roll, is whoever RECEIVES the aura. Deducting across that actor gap isn't wired up; rather than half-build it, it's blocked at the config UI entirely.
- **Multipart groups**: the whole Consumption fieldset only renders for a simple bonus (see config-details.hbs); a multipart group's sub-bonuses have no consumption concept in this version.
- **No "can afford it" gate on the dialog**: a bonus with consumption configured is offered in the Optional dialog the same way regardless of whether the actor currently has enough of the resource to cover even the minimum; accepting it just clamps the underlying value to 0 rather than refusing the roll. Worth keeping an eye on in play.

---

## P. Modification Type (dice modifiers: this session's feature)

A **Modification Type** dropdown now sits right after Bonus Type on the Details tab, for any simple (non-multipart) bonus whose type has an actual dice concept. Left on the default, **Simple Bonus**, nothing changes: the Bonus Formula field adds to the roll exactly like before. Any other choice turns this bonus into a dice REWRITER instead: it adds no term of its own, and the Bonus Formula field is repurposed as that mode's threshold value (its label and hint change to match). Instead of adding to the roll, it rewrites EVERY die already in that roll's final formula, the base/weapon roll's own dice AND any other bonus's added dice alike, gated by this bonus's own filters exactly like any other bonus (Applies To, foe/item/spell filters, Optional, etc. all still work normally).

The five modes: **Reroll** (any die at or below the value gets rerolled once), **Minimum Die Value** (any die below the value counts as the value instead), **Maximum Die Value** (any die above the value is capped down to it), **Explode** (any die at or above the value rerolls and adds the new result, repeating on further explosions; leave the value blank to only explode on a die's own highest face), and **Resize** (every die STEPS UP this many sizes along d4 → d6 → d8 → d10 → d12 → d20 — not an absolute face count. `1` turns a d4 into a d6 and a d10 into a d12; `2` turns a d6 into a d10. A negative value steps down instead).

Which modes are offered depends on Bonus Type: **Reroll** and **Minimum Die Value** are offered on every type with a d20 or dice pool (Saving Throw, Ability Check, Skill, Attack, Death Save, Hit Die, Initiative, Damage, Healing, Temp HP). **Explode**, **Maximum Die Value**, and **Resize** are offered only on the true dice-pool types (Damage, Healing, Temp HP, Hit Die) — a lone d20 doesn't "explode" or get resized. **Spell Save DC**, **Crit Range**, **Advantage**, and **Disadvantage** bonuses (and multipart groups entirely) never show the dropdown at all; there's nothing there to rewrite.

**Known limitation:** dice modifiers are not yet supported on FOE-filtered bonuses (a bonus with any Target filter set) — those route through a separate gathering/application path (section D) that this feature doesn't hook into yet. A modifier-type bonus with a Target filter set will currently be silently ignored at roll time rather than erroring; if you need this, flag it for a follow-up pass.

**P.1 — Great Weapon Fighting-style reroll on damage**
```json
{"cb":"bonus","version":1,"bonus":{"name":"P1 GWF Reroll","type":"damage","modType":"reroll","bonus":"2"}}
```
Paste on Roller. Roll damage with a weapon that deals more than one die (or stack with another dice-adding bonus, e.g. A.4's sibling with a `1d6` formula) so there's something to see. Any die that comes up 1 or 2 should show as rerolled once (Foundry's own dice-tooltip breakdown marks rerolled dice) — including the weapon's OWN base damage die, not just an added bonus die.

**P.2 — Minimum die value on damage**
```json
{"cb":"bonus","version":1,"bonus":{"name":"P2 Min Die 3","type":"damage","modType":"minDie","bonus":"3"}}
```
Paste on Roller. Roll damage: no die in the final total should show below 3 (a natural 1 or 2 shows in the tooltip as bumped up to 3).

**P.3 — Maximum die value on healing**
```json
{"cb":"bonus","version":1,"bonus":{"name":"P3 Max Die 4","type":"heal","modType":"maxDie","bonus":"4"}}
```
Paste on Roller. Roll a healing roll with at least one die bigger than d4 in the mix (e.g. pair with a `2d8` heal formula bonus): any result above 4 on those dice is capped down to 4.

**P.4 — Explode on temp HP, with a threshold**
```json
{"cb":"bonus","version":1,"bonus":{"name":"P4 Explode 5+","type":"temphp","modType":"explode","bonus":"5"}}
```
Paste on Roller. Roll a temp HP grant with dice in it: any die showing 5 or higher rerolls and adds the new result, repeating if that new result is also 5+.

**P.5 — Explode with no threshold (own max face only)**
```json
{"cb":"bonus","version":1,"bonus":{"name":"P5 Explode Max Face","type":"damage","modType":"explode","bonus":""}}
```
Paste on Roller. Roll damage with a mix of die sizes (e.g. a d6 weapon plus a `1d4` bonus): the d6 only explodes on a 6, the d4 only explodes on a 4 — each against its OWN max face, not a shared literal number.

**P.6 — Resize: step every die up one size**
```json
{"cb":"bonus","version":1,"bonus":{"name":"P6 Resize +1","type":"damage","modType":"resize","bonus":"1"}}
```
Paste on Roller. Roll damage on a weapon with a d4 or d10 base die (or stack with a dice-adding bonus of one of those sizes): a d4 die should actually be rolled as a d6, and a d10 die as a d12 — check the die SIZE shown in the roll's tooltip breakdown, not just the total. Then edit the bonus's Bonus Formula to `2` and roll again with a d6 in the mix: it should now roll as a d10 (two steps: d6 → d8 → d10). A d20 (initiative/attack dice aren't eligible for Resize, but a d20 damage die from some other source would be) should stay a d20 regardless of the value, since it's already the top of the table.

**P.7 — Modification Type hidden/forced back to Simple**
In BonusConfig, create a bonus of type Attack and set Modification Type to Reroll (Attack supports Reroll/Minimum Die Value only, not Explode/Maximum/Resize — confirm those three aren't even in the dropdown). Save, then reopen the bonus and change Bonus Type to **Spell Save DC**: the Modification Type row should disappear entirely, and the Bonus Formula field should relabel back to "Spell Save DC Bonus". Save and reopen once more: Modification Type should have silently reverted to Simple Bonus (not stuck on the old Reroll value) — confirms the type-change clamp in both the UI and bonus.mjs's normalization actually took effect, not just the dropdown's visibility.

---

**If something silently does nothing:** check the console first, most guards `console.warn` rather than failing loudly. With Debug logging off, only warnings/errors show; turn it on if you need the full trace to see why a bonus wasn't gathered.
