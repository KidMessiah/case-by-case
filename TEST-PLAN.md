# Case by Case: Test Plan

A checklist of bonuses to build and rolls to trigger, covering every feature and known edge case. Work through it top to bottom; each test names what to build, what to roll, and what should happen.

**Suggested test roster:** one PC (the "caster/roller"), one ally token, and two NPC targets, one Undead (or any distinct creature type), one not. Put the ally within 10ft for aura tests and outside 10ft for range tests.

---

## 1. Basic bonus types (native, should show on the character sheet)

- [ ] **1.1** `+2`, type **Saving Throw**, no filters. Check: appears on the sheet's saving throw bonus; applies to every save.
- [ ] **1.2** `+1`, type **Ability Check**, no filters. Check: sheet bonus; applies to every ability check.
- [ ] **1.3** `+2`, type **Skill Check**, Abilities/Skills filter set to one skill (e.g. Perception only). Check: only that skill's roll gets it.
- [ ] **1.4** `+1d4`, type **Attack Roll**, no filters. Check: sheet bonus; dice formula shows up in the to-hit roll.
- [ ] **1.5** `+1`, type **Spell Save DC**, no filters. Check: raises the DC shown in the spellcasting panel.
- [ ] **1.6** `+2`, type **Death Save**. Check: applies at death saving throws (roll-time only, no sheet key).
- [ ] **1.7** `+1d4`, type **Hit Die**. Check: applies when rolling a hit die.

## 2. Roll-context filters (forces roll-time injection instead of a sheet key)

- [ ] **2.1** `+2` damage, Damage Type filter = Fire. Check: applies on a fire spell/weapon, not on a non-fire one; no longer shows on the sheet (roll-time now, not native).
- [ ] **2.2** `+1` attack, Attack Mode filter = Melee Weapon. Check: applies to melee weapon attacks only, not ranged/spell attacks.
- [ ] **2.3** `+1` attack, Spell School filter = Evocation. Check: only evocation spell attacks get it.
- [ ] **2.4** `+1` attack, Min Spell Level = 3. Check: only 3rd-level+ spells get it.
- [ ] **2.5** `+1` damage, Min Spell Slots = 1. Check: bonus disappears once you're out of spell slots.
- [ ] **2.6** Comparison filter (raw formula match). **Fixed this session:** a comparison-filtered bonus is now always routed off the native (prep-time) path and evaluated fresh at roll time instead, so derived-value comparisons (e.g. an ability modifier) are no longer timing-sensitive. See TEST-BONUSES.md section I for ready-to-paste cases (I.1 exercises a derived value, I.2 is a source-data control).
- [ ] **2.7** **New this session:** Proficiency filter (Roll tab, only visible on Saving Throw/Ability Check/Skill Check). Build "Reliable Talent": Modification Type = Minimum, value 10, Bonus Type = Skill Check, Proficiency = Either. Roll a skill you're proficient in (applies) and one you're not (doesn't). Then try Proficiency = Expertise on a skill you only have plain proficiency in (should NOT apply) vs. one you have Expertise in (applies). Confirm it's forced off the character sheet (roll-time only, like Comparison above) since proficiency depends on which specific ability/skill is actually being rolled.

## 3. Self/Recipient filters (the creature *receiving* the bonus)

- [ ] **3.1** `+2` save, Creature Type filter = your own type. Check: applies to you; make a copy of the bonus with a *different* type and confirm it does NOT apply.
- [ ] **3.2** `+1` check, Movement filter = Fly. Check: only applies to a creature that actually has a fly speed.
- [ ] **3.3** `+1` save, Condition filter = Prone. Check: only applies while the recipient is prone.

## 4. Optional bonuses (pre-roll dialog)

- [ ] **4.1** Optional `+2` damage (no foe filter). Roll damage: dialog appears; accept → applies; decline → doesn't.
- [ ] **4.2** Optional `+2` attack (no foe filter). Same check on an attack roll.
- [ ] **4.3** Optional `+2` save/check/skill (no foe filter). Confirm the *other* dialog path (not attack/damage) also prompts correctly.
- [ ] **4.4** Optional Crit Range bonus. **Fixed this session:** it now piggybacks on the attack roll's existing optional-bonus dialog; check: rolling an attack shows a "crit on N+" row, accepting it lowers the crit threshold for that attack, declining leaves it normal. Also try a foe-filtered optional Crit Range bonus and confirm it's only offered when a current target matches (tagged "vs. target"). See TEST-BONUSES.md section H (H.3/H.4) for ready-to-paste cases.

## 5. Multipart groups

- [ ] **5.1** "Great Weapon Master"-style group: Optional, timing **before the attack roll**, children `-5` Attack / `+10` Damage. Roll attack: prompted once; accept → `-5` applies to the attack immediately and `+10` carries automatically to the damage roll with no second prompt; decline → neither applies.
- [ ] **5.2** Same group, timing **before the damage roll** instead. Confirm the single prompt now happens at the damage roll.
- [ ] **5.3** Same shape, timing **ask before each associated roll**. Confirm each child now prompts independently at its own matching roll instead of one combined choice.
- [ ] **5.4** Non-optional (mandatory) group with an attack child and a damage child. Confirm both apply automatically with no prompt at all.
- [ ] **5.5** Accept the group on one attack, then roll a **new** attack (new use). Confirm it re-prompts fresh and doesn't wrongly carry the old decision.
- [ ] **5.6** Try to add a second child of an incompatible type (e.g. a Saving Throw child next to an existing Attack child). Confirm the "Applies To" dropdown restricts the option rather than letting you create a mixed group.
- [ ] **5.7** Open "Add sub-bonus" on a child. Confirm the editor shows Roll, Recipient, and Target tabs (same as a top-level bonus) but NOT Consumption, Scope, Stacking, or Aura, and the Behavior fields (Optional/When To Ask) don't appear at all.
- [ ] **5.8** Group with two Damage children: child A has a Foe filter (e.g. target type = Undead), child B has none. Roll damage against a non-undead target: only child B applies. Against an undead target: both apply.
- [ ] **5.9** Group with a Proficiency filter set on one child only (e.g. a Check child filtered to Expertise). Roll with a skill you're merely proficient in (not expert): that child is skipped, sibling children still apply.
- [ ] **5.10** Reliable-Talent-style group where one child has an Item/Spell filter (e.g. weapon-only) and its sibling has none. Roll with a non-matching item: only the unfiltered child applies.
- [ ] **5.11** Timed group (timing **before the attack roll**) where the carried "later" child (the damage one) has its own Foe filter. Accept on the attack against a matching target, then confirm the carried damage bonus still applies at the damage roll; against a non-matching target, confirm it's held back correctly reflecting its own filter, not the group's.
- [ ] **5.12** Confirm Consumption still lives only on the parent group (one shared cost, spent once when the group is accepted) — editing a child's cost isn't offered anywhere in the child editor.
- [ ] **5.13** "Great Weapon Master"-style group (timing **before the attack roll**), Consumption on: e.g. 1 use of a limited-use feature, `@consumed` referenced in one child's formula. Roll attack: dialog shows the group's cost row (fixed or ranged, matching whatever's configured); accept → the resource is spent exactly once and `@consumed` resolves correctly in both the attack child (applied now) and the damage child (carried); decline → nothing is spent.
- [ ] **5.14** Same group as 5.13 but with the actor at 0 of the resource. Confirm the group's row is disabled/unaffordable in the dialog, same as a simple optional bonus would be.
- [ ] **5.15** Same group as 5.13, but change When To Ask to **ask before each associated roll**. Confirm the Consumption toggle in the group's own editor is now locked off (with a tooltip explaining why) and any previously-configured cost is not offered anywhere.
- [ ] **5.16** Confirm Consumption is still unavailable for an Aura multipart group (locked off with the existing aura tooltip), regardless of timing.
- [ ] **5.17** Open the GROUP's own editor (not a child's). Confirm it shows Roll/Recipient/Target tabs same as a simple bonus, in ADDITION to Behavior — this is the group's own top-layer filter, separate from each child's.
- [ ] **5.18** Group with a top-layer Roll filter (e.g. Item Types = Weapon only) and two children, neither with its own Roll filter. Roll with a non-weapon item: neither child applies (group-level filter blocks the whole group). Roll with a weapon: both apply.
- [ ] **5.19** Same group as 5.18, but now also give one child its own Foe filter (e.g. vs Undead) while the top-layer stays "Weapon only." Roll with a weapon against a non-undead target: only the unfiltered child applies. Roll with a weapon against an undead target: both apply. Roll with a non-weapon item: neither applies regardless of target (top-layer still gates everything).
- [ ] **5.20** Non-optional (mandatory) group with a top-layer Target (foe) filter (e.g. vs a Bloodied target) and no per-child foe filters at all. Roll damage against a non-bloodied target: nothing applies. Against a bloodied target: applies. (This required+group-foe combination is required-only — it needs an actual target to resolve, same as a required foe-filtered simple bonus.)
- [ ] **5.21** Optional associated-timing group with a top-layer foe filter. Confirm the whole group simply isn't offered in the pre-roll dialog at all when no current target matches, even though none of the children carry their own foe filter.
- [ ] **5.22** **Divine Smite build.** Optional Damage bonus, formula `(1 + @consumed)d8[radiant]`, Consumption → Spell Slot → **Any Available Slot**. Confirm the Details tab shows an explanatory note instead of a min/max Amount range. Roll a damage-capable attack (or a simple optional damage bonus on a weapon hit) and accept: the dialog shows a dropdown of your currently-available slot levels (not a stepper); pick e.g. a 3rd-level slot. Confirm the applied damage used `@consumed = 3` (i.e. `4d8[radiant]`), and that exactly one 3rd-level slot was deducted afterward (check the character sheet) — not 3 slots, and no other level's pool touched.
- [ ] **5.23** Same bonus as 5.22, but drain all the actor's spell slots to 0 first. Confirm the row is disabled/unaffordable ("No spell slots available") in the dialog rather than offering an empty or broken dropdown.
- [ ] **5.24** Same bonus as 5.22, but pick a **different** slot level each of two separate rolls (e.g. 1st-level then 5th-level). Confirm `@consumed` and the actual deducted pool both track whichever level was picked that time, not a level fixed at bonus-creation time.
- [ ] **5.25** Multipart group (timing **before the damage roll**) with Consumption → Spell Slot → **Any Available Slot**, and a child formula using `@consumed`. Confirm the group-level Any-slot picker behaves the same as 5.22 (dropdown of available levels, one shared pick for the whole group), and that the chosen level is substituted into every child's formula that references `@consumed`.

- [ ] **6.1** `+2` attack, aura enabled, range 10ft, Affects = Allies, Self = on. Check: applies to the source and allies within 10ft; not to enemies; not to allies past 10ft.
- [ ] **6.2** `-2` save, aura, Affects = Enemies. Check: debuffs nearby hostile creatures' saves (the disposition-based "debuff foes" pattern).
- [ ] **6.3** Same aura, Affects = Everyone. Check: applies regardless of disposition.
- [ ] **6.4** Aura with "Requires Consciousness" on. Knock out / incapacitate the source. Check: aura stops affecting others.
- [ ] **6.5** Aura with a Blocked Status set (e.g. Silenced). Apply that status to the source. Check: aura turns off.
- [ ] **6.6** Aura with Self = off. Check: the source itself does NOT get the bonus, only others in range.
- [ ] **6.7** Place source and an ally at the same horizontal distance but a large elevation difference (e.g. one flying 30ft up), just inside horizontal range but outside true 3D range. Check: aura correctly does NOT apply (elevation counted into distance).
- [ ] **6.8** Toggle "show radius" on an **Actor**-hosted aura bonus. Check: a ring appears on canvas. Then check an **Item**- or **Effect**-hosted aura bonus, the radius toggle should be hidden entirely for those.
- [ ] **6.9** As a non-GM player, hover a *hidden* enemy token. Check: no aura hint appears. As GM, hover the same token: hint appears.
- [ ] **6.10** Two aura (or local) bonuses with the *same* Stacking Tag affecting one roll. Check: only the larger value applies. Then two bonuses with *different* tags (or blank): both apply/stack.
- [ ] **6.11** Multipart aura group, Optional, timing **associated**, projected from a nearby ally. Check: each matching child prompts per-roll, independent of the others.
- [ ] **6.12** Multipart aura group, non-optional. Check: both children apply automatically at their respective rolls with no prompt.

## 7. Foe (Target) filters, only available on Attack / Damage / Crit Range

- [ ] **7.1** `+2` attack, Target tab → Creature Type = Undead. Roll attack vs. the Undead NPC (applies) and vs. the non-Undead NPC (doesn't).
- [ ] **7.2** `+2d6` damage, Target tab → Creature Type = your chosen type, on an AoE spell (e.g. Fireball) hitting both NPCs at once. Check: bonus only lands on the matching target's share of damage, not uniformly on everyone hit.
- [ ] **7.3** Crit Range bonus (crits on 19+), Target tab → Condition = Prone. Roll attack vs. a prone target (lowered crit threshold) and vs. a standing target (normal threshold).
- [ ] **7.4** `+1` attack, Target tab → Within Range = 10ft. Test from 5ft (applies) and 15ft (doesn't).
- [ ] **7.5** `+1d6` damage, Target tab → Bloodied filter enabled, left at its default 50%. Test vs. a target above half HP (no bonus) and at/below half HP (bonus applies). Then change the percentage to 25 and confirm the threshold actually moves (bonus now only applies at or below a quarter HP).
- [ ] **7.6** Spot-check the remaining Target fields once each: Size, Movement Type, Language.
- [ ] **7.7** Same as 7.1 but as an **aura** projected onto the roller from a nearby ally, instead of a bonus the roller has locally. Confirm it still only fires when the current target matches.
- [ ] **7.8** Non-optional multipart group with Target filters set on the group (e.g. Undead), children `+2d8` damage / lower crit range. Roll vs. a matching and non-matching target. Check: both children apply together automatically, only against the matching target.
- [ ] **7.9** With a foe-filtered Attack bonus active, toggle midi-qol's "Auto Check Hit" world setting between its options and confirm the bonus still applies to the to-hit roll either way.
- [ ] **7.10** Roll an attack/damage with **nothing targeted**. Check: no error, no dialog, foe-filtered bonuses simply don't apply.
- [ ] **7.11** **New capability.** Bonus Type: Advantage, Roll Kinds = Attack, Target(foe) tab: Bloodied filter (or Creature Type / Has Effect by name). Confirm the Target tab is now selectable (previously permanently greyed out for Advantage/Disadvantage) and that attacking a matching target actually grants advantage while a non-matching target doesn't. Then set Roll Kinds to something WITHOUT Attack (e.g. just Saving Throw) and confirm the Target tab greys back out and any previously-set foe filter is cleared on save (not just hidden).

## 8. Optional + Foe filters together (the newest feature)

- [ ] **8.1** Optional `+2` attack, Target tab → Creature Type = Undead. Target the Undead NPC and roll: dialog offers it, tagged "vs. target." Target the non-Undead NPC and roll: dialog doesn't offer it at all.
- [ ] **8.2** Same idea with a Damage bonus against an AoE hitting a mixed group of targets, confirm it's offered when at least one target matches, AND (now that accepted foe-damage routes through the same per-target engine as 7.2) confirm the accepted bonus only lands on the matching target's share of damage, not uniformly on everyone hit.
- [ ] **8.3** Optional multipart group, timing **before the attack roll**, Target filters set. Offered only vs. a matching target; accept and confirm carry-to-damage still works; decline and confirm nothing carries.
- [ ] **8.4** Same group shape, timing **associated**. Confirm each matching child prompts per-roll, only when the current target matches.
- [ ] **8.7** **Regression check (accepted foe-damage bonus silently vanishing).** Optional `+1d8` damage bonus, Target tab → Creature Type = Undead, on a single-target weapon attack (not an AoE — this is the melee-attack-then-damage path, e.g. a mace). Attack an Undead target, hit, and accept the bonus when the dialog offers it (tagged "vs. target"). Confirm the extra 1d8 actually shows up in the final damage total/card — previously this was accepted in the dialog but then silently dropped and never applied (confirmed via console log: "candidate bonuses found: 0" on the damage roll every time, even on a hit against a matching target) because of a key mismatch between where the accepted bonus was stashed and where it was later looked up.
- [ ] **8.5** Optional simple bonus, foe-filtered, delivered via an **aura** from a nearby ally. Confirm it's only offered when your current target matches.
- [ ] **8.6** Build a bonus as Attack type with Target filters set, then change its type to Saving Throw and save. Check: the Target tab greys out and the filter data is cleared (not just hidden), confirm by switching back to Attack and seeing the filters are gone.

## 9. Item scoping ("This Item Only") and clipboard copy/paste

- [ ] **9.1** `+1` attack, "This Item Only" ON, hosted on Sword A (a weapon with an attack activity), no other filters. Attack with Sword A (applies) and with Sword B, an otherwise-identical weapon on the same actor (does NOT apply). This is the simplest possible case: a plain, non-optional, non-aura, filterless scoped bonus, and the one most likely to silently regress.
- [ ] **9.2** Same as 9.1 but Damage type. Confirm the scoped damage bonus only applies to Sword A's damage roll, not Sword B's.
- [ ] **9.3** Optional multipart group ("Great Weapon Master"-style), "This Item Only" ON, timing before the attack roll, hosted on Sword A. Roll attack with Sword A: prompted normally. Roll attack with Sword B: not even offered in the dialog.
- [ ] **9.4** "This Item Only" toggle on a Feature (non-weapon item) with no activities yet. Confirm the toggle is greyed out / unavailable. Add an Attack activity to the Feature and confirm the toggle becomes available without reopening the config.
- [ ] **9.5** With "This Item Only" ON, confirm a Spell School filter greys out if the host item isn't a spell, and un-greys live if you change the item's activities to add spell-like capability.
- [ ] **9.6** Copy a bonus with "This Item Only" ON (the manager's Copy button), then Paste it onto a *different* item. Confirm "This Item Only" is automatically cleared on paste rather than silently pointing at the wrong item.
- [ ] **9.7** Copy a multipart group and paste it onto the same sheet. Confirm the pasted copy is fully independent (editing/deleting one doesn't affect the other) and both work correctly side by side.

## 10. Data integrity / UI edge cases

- [ ] **10.1** Toggle a bonus off in the manager list. Check: stops applying immediately, no reload needed.
- [ ] **10.2** Put a bonus on an Active Effect, then disable (or suppress, e.g. via a missing prerequisite) that effect. Check: bonus stops applying while off/suppressed.
- [ ] **10.2b** **New:** open an Active Effect's own config sheet (from an Actor's Effects tab, or an Item's) and confirm the "Case by Case" header button now appears there (previously only Actor/Item sheets had it) and opens the same Bonus Manager. Re-verify 10.2's toggle-off behavior through this UI directly: create a bonus on the effect from this new entry point, confirm it applies, then click the effect's own Enabled toggle off and confirm the bonus stops applying without reopening anything.
- [ ] **10.3** Delete a bonus mid-session. Check: no stale references or console errors on the next roll.
- [ ] **10.4** Build one bonus each on an Actor, an Item, and an Active Effect. Check: all three apply correctly; only the Actor-hosted one shows the radius-ring toggle.
- [ ] **10.5** Confirm the Optional toggle greys out correctly and un-greys correctly as you flip a bonus between targetable and non-targetable roll types.

## 11. Stress / combination

- [ ] **11.1** Stack 5+ bonuses of different types and sources (item + effect + actor-level + two auras) on one attack roll. Check: no duplicates, nothing missing, stacking-tag dedup works across sources.
- [ ] **11.2** Fire off two separate attacks/spells back-to-back in quick succession. Check: a foe-filtered bonus from the first roll doesn't leak into or affect the second, independent roll.

---

**Notes while testing:** if something silently does nothing, check the console for warnings first (several guards `console.warn` instead of failing loudly, e.g. the multipart type-mixing guard). Turn on the "Debug logging" module setting for the full diagnostic trace if a warning alone isn't enough to see why a bonus wasn't gathered. See **TEST-BONUSES.md** for ready-to-paste JSON versions of most of these cases, plus additional coverage for the advantage/disadvantage system, stacking-tag d20-control, foe-damage crit doubling/resistance bypass, and a few cross-session regression scenarios not represented here.

**Start with 9.1.** It's the simplest possible "This Item Only" case: a plain, filterless attack bonus scoped to one weapon, and the one most likely to silently regress if the scoping logic drifts, since it's easy to accidentally special-case away.
