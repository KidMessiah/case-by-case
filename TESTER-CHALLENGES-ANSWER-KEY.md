# Case by Case: Tester Challenges — Answer Key (GM only, don't hand this to testers)

Intended build for each task in TESTER-CHALLENGES.md, plus the UX risk it's actually testing.

**Revision note (2026-07-10):** this pass re-verified every task against the module's actual
current behavior rather than assumed behavior. Two real, confirmed problems turned up and were
fixed rather than papered over in this doc:

- 2.4 (Faerie Fire) and 4.2 (Bloodied Advantage) both required "grant advantage on an attack
  based on something about the target," which was **flatly impossible** before this pass — the
  Advantage/Disadvantage bonus type wasn't in the targetable-types set, so its Target (foe) tab
  was permanently inert, and separately the roll-time foe-bonus gatherers matched a bonus's type
  literally against the roll type, which can never equal "advantage"/"disadvantage." Both bugs
  are now fixed (BonusConfig.mjs + hooks.mjs's `_gatherFoeBonuses`/`_gatherAuraFoeBonuses`), so
  these two tasks are valid and working as originally intended.
- 2.2 (Improved Critical) was previously described in this doc as a "Modification Type," which
  doesn't exist for crit range at all — corrected below.
- 4.5 (Divine Smite) is rebuilt here to use the "Any Available Slot" consumption option (added
  this session), which lets the accepted damage scale correctly with whichever slot level the
  player actually spends — the old two-independent-bonuses workaround this doc used to describe
  couldn't do that and is no longer the recommended build.

## Tier 1

**1.1 Archery** — Bonus Type: Attack Roll, `+2`, Details tab filter: Attack Mode = Ranged Weapon
(or Weapon Property, depending on how they read "ranged weapons"). *Risk: is Attack Mode
discoverable, or do they miss it and give +2 to everything?*

**1.2 Guidance** — Ability Check, `1d4`, no filters (single check = whichever check they roll,
that's fine — the "one check" wording is flavor, not a mechanical constraint here).

**1.3 Bless** — Two bonuses: Attack Roll `1d4` and Saving Throw `1d4`. *Risk: do they realize one
rule sentence covering two roll types needs two bonus entries, or do they hunt for a multi-type
picker that doesn't exist for this bonus shape (that only exists for Advantage/Disadvantage)?*

**1.4 Warding vs. frightened** — Saving Throw bonus, **Recipient tab** filter: Condition =
Frightened (this is `targetConditions` — the recipient's own current status effects, with full
UI on the Recipient tab). Don't confuse this with `actorConditions`, a separate schema field that
also exists in the code but has **no UI anywhere** to actually set it — it's dead/orphaned, not a
second valid path. *Risk: "frightened" isn't a bonus TYPE, it's a condition FILTER — tests whether
they conflate the two.* Note for the GM: this models "gets the bonus while already frightened,"
not literally "bonus to the specific saving throw that would resist becoming frightened" —
case-by-case has no way to inspect what condition an incoming save would inflict, so the real 5e reading
of this rules text isn't buildable as stated. That's an intentional simplification for this task,
not something the tester needs to discover or work around.

## Tier 2

**2.1 Reliable Talent** — Modification Type = Minimum Die Value, value 10, Bonus Type: Ability
Check (and/or Skill Check). For a fully rules-accurate build, also set the Roll tab's Proficiency
filter to Proficient (or Either, if you want to include half-proficiency sources like Jack of All
Trades) — that's exactly what "checks that let you add your proficiency bonus" means, and the
filter exists for precisely this. *Risk: discovering Modification Type exists at all, since it's
a separate concept from a flat/dice bonus — and separately, whether they find the Proficiency
filter or just leave the check unfiltered (a reasonable simplification, but worth noting which).*

**2.2 Improved Critical** — Bonus **Type** = Critical Range (this is its own entry in the Applies
To dropdown, NOT a Modification Type — Modification Type only offers Reroll/Minimum/Maximum/
Explode/Resize, none of which are "crit range"), value `19` (crits on 19 or better). For full
accuracy to "weapon attacks" specifically, also set the Roll tab's Attack Mode filter to Melee
Weapon + Ranged Weapon (excluding spell attacks). *Risk: this is the first task where the right
answer isn't under Modification Type at all — does the tester correctly find Critical Range as
its own Bonus Type instead of hunting through Modification Type options for something that isn't
there?*

**2.3 Halfling Luck** — Modification Type = Reroll, value 1, Bonus Type set to Attack Roll +
Ability Check + Saving Throw (three separate bonuses, most likely). *Risk: same
"one rule, three bonus entries" pattern as Bless.*

**2.4 Faerie Fire** — Bonus Type = **Advantage**, Details tab Roll Kinds = Attack, Target tab:
Has Effect (by name) = "Faerie Fire". *Risk: two things stacked — first, realizing Advantage is
its own Bonus Type (not a toggle on an Attack Roll bonus — that toggle doesn't exist there), and
second, that the Target tab only lights up for an Advantage/Disadvantage bonus once Attack is
selected among its Roll Kinds (every other roll kind has no opposing creature, so the tab stays
inert for those). Also requires knowing to manually apply an Active Effect named "Faerie Fire" to
the NPC to test it, since Case by Case doesn't create that effect itself.*

## Tier 3

**3.1 Aura of Protection** — Saving Throw bonus, formula `@abilities.cha.mod`, Aura enabled,
range 10, Self = on, Affects = Allies. *Risk: do they find the @ref formula autocomplete, and do
they remember to turn Self on (real Aura of Protection benefits the paladin too)?*

**3.2 Frightful Presence** — Disadvantage bonus type (or Grants Disadvantage toggle on a Saving
Throw bonus — both are valid approaches, note which), Aura enabled, range 10, Affects = Enemies.
Note this is a genuinely different mechanism from 2.4/4.2's foe-side targeting: aura disposition
(who's "in range and hostile") decides who receives this, not a Target/foe filter, so it isn't
affected by the same targetability restriction those tasks hit.

**3.3** — No new build. Toggle "Requires Consciousness" on the 3.1 aura (if not already on by
default) and verify.

## Tier 4

**4.1 Smite the Undead** — Damage bonus formula `2d6[radiant]` (the damage type is written
directly into the formula with the `[radiant]` tag — there's no separate "damage type" dropdown
for a bonus's own output, only for the "damage type FILTER" that checks what the base attack
already deals), Target tab: Creature Type = Undead + Fiend (multi-select). *Risk: do they find the
Target tab at all vs. the Details/self filters tab — this is the first purely foe-side task. A
secondary risk: do they go looking for a damage-type dropdown that doesn't exist for this
purpose, instead of writing it into the formula?*

**4.2 Bloodied Advantage** — Bonus Type = Advantage, Details tab Roll Kinds = Attack, Target tab:
Bloodied filter, threshold 50% (default). Same underlying mechanism as 2.4 — if a tester already
solved that one, this should be noticeably faster. *Risk: same two-part discovery as 2.4
(Advantage as its own Type, Target tab lighting up only once Attack is a selected Roll Kind);
worth comparing build time against 2.4 as a "did they actually learn the pattern" signal.*

**4.3 Great Weapon Master** — Multipart group, Optional, timing "before the attack roll" (or
"before the damage roll" — either is correct as long as it's a single prompt), child 1: Attack
`-5`, child 2: Damage `+10`. *Risk: the biggest one in the set — do they find Multipart Groups at
all, or do they build two disconnected optional bonuses that each prompt separately (wrong,
breaks the "one decision, two rolls" requirement)?*

**4.4 Bardic Inspiration** — Optional Attack Roll / Ability Check / Saving Throw bonus (three
entries, or however many they interpret "one attack roll, ability check, or saving throw" as),
formula `1d8`, Consumption enabled, resource type "uses" or "resource" pointing at a real
limited-use item/resource they create first (3 uses, long rest recovery), NOT just a manually
toggled checkbox bonus. *Risk: do they reach for Consumption at all, or do they fake "limited
uses" by just remembering to disable the bonus manually after 3 rolls — that's the failure mode
this task is designed to catch.*

**4.5 Divine Smite, full rule** — A **multipart group** (not two independent simple bonuses),
timing "before the damage roll," Optional, group-level Consumption = Spell Slot → **Any
Available Slot**. Child 1: Damage, formula `(1 + @consumed)d8[radiant]`, no filter (this is the
base 2d8-at-1st-level-scaling-by-1d8-per-level-above-1st part — `@consumed` resolves to whichever
slot level the player picks when accepting). Child 2: Damage, formula `1d8[radiant]`, Target tab:
Creature Type = Undead + Fiend (the "+1d8 vs. undead/fiend" clause). Both children ride on the
SAME accept decision and the SAME single slot expenditure — exactly one slot gets spent
regardless of whether child 2 also fires, and the chosen level feeds into both children's
formulas automatically (see hooks.mjs's `_resolveChosenGroups`). *Risk: the real test is whether
the tester discovers "Any Available Slot" (a dropdown of currently-available levels at accept
time, not a fixed configured amount) combined with a multipart group's single shared Consumption,
rather than reaching for two unrelated optional bonuses that can't correctly share one spend and
can't make the base damage scale with slot level at all.*

---

**What "good" looks like across the whole set:** time should trend down as testers move through
tiers (learning the tool), except at 4.3 and 4.5, which are deliberately new concepts (multipart,
shared consumption) and SHOULD spike back up. If tier 1/2 tasks are already taking a long time,
that's a discoverability problem in the base UI, not a "hard feature" problem.
