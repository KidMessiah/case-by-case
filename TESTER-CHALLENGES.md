# Case by Case: Tester Challenges

Usability test, not a bug hunt. Each task describes a real D&D 5e feature in plain rules
language, on purpose, with no mention of which Case by Case tab or field to use. Hand this file
to a tester who hasn't configured a bonus before and watch (or have them self-report) how they
get from "read the rule" to "built and working."

**Setup:** one PC to build bonuses on, one friendly ally token, two NPC targets (make one
Undead or another distinct creature type, leave the other generic).

**For each task, have the tester record:**
- Time to build it
- Any field/tab they couldn't find or guessed wrong on
- Whether the result actually matched the rule text when rolled
- Anything they tried that felt like it should work but didn't

No answer key in this file on purpose — don't peek before attempting.

---

## Tier 1: Single bonus, one condition

**1.1 — Archery.** "You gain a +2 bonus to attack rolls you make with ranged weapons."

**1.2 — Guidance.** "You can add 1d4 to one ability check of your choice."

**1.3 — Bless.** "Whenever you make an attack roll or a saving throw, you can add 1d4 to the roll."
(Two separate rules text lines, one bonus feature — figure out how many bonuses that takes.)

**1.4 — Warding.** "You have a +1 bonus to saving throws against being frightened."
(There's no "frightened save" bonus type — find the filter that gets you there instead.)

## Tier 2: Dice modification and advantage/disadvantage

**2.1 — Reliable Talent.** "Whenever you make an ability check that lets you add your
proficiency bonus, you can treat a d20 roll of 9 or lower as a 10."

**2.2 — Improved Critical.** "Your weapon attacks score a critical hit on a roll of 19 or 20."

**2.3 — Halfling Luck.** "Whenever you roll a 1 on the d20 for an attack roll, ability check, or
saving throw, you can reroll the die and must use the new roll."

**2.4 — Faerie Fire.** "Attack rolls against a creature affected by Faerie Fire have advantage,
if the attacker can see it." (Skip the "can see it" clause — just get the advantage-when-target-
is-affected part working. You'll need to apply the "Faerie Fire" effect to an NPC by name to
test it.)

## Tier 3: Area effects (auras)

**3.1 — Aura of Protection.** "Saving throws for you and every friendly creature within 10 feet
of you gain a bonus equal to your Charisma modifier." (Use a formula, not a flat number — and
decide whether the source itself benefits.)

**3.2 — Frightful Presence (simplified).** "Hostile creatures within 10 feet of this creature
have disadvantage on saving throws." (No save-vs-DC step needed — just the disadvantage grant.)

**3.3 — Consciousness check.** Take the aura from 3.1 and confirm it turns off if the source is
knocked unconscious. Don't build anything new for this one — just verify.

## Tier 4: Targeting the enemy, and spending resources

**4.1 — Smite the Undead.** "Your weapon attacks deal an extra 2d6 radiant damage against
undead and fiends."

**4.2 — Bloodied Advantage.** "You have advantage on attack rolls against a creature that is at
or below half its hit point maximum."

**4.3 — Great Weapon Master.** "Before you make a melee weapon attack that you're proficient
with, you can choose to take a -5 penalty to the attack roll. If the attack hits, add +10 to the
damage." (One decision, two rolls affected — get the +10 to land on the damage roll for the SAME
attack, without a second prompt.)

**4.4 — Bardic Inspiration.** "As a bonus action, you can give yourself a Bardic Inspiration die
(1d8). Once within the next 10 minutes, you can add it to one attack roll, ability check, or
saving throw of your choice. You have 3 uses, and they come back on a long rest." Model the
"limited uses" part as a real, spendable resource — not just a bonus you can toggle on and off.

**4.5 — Divine Smite, full rule.** "When you hit a creature with a melee weapon attack, you can
expend one spell slot to deal radiant damage to the target, in addition to the weapon's damage.
The extra damage is 2d8 for a 1st-level spell slot, plus 1d8 for each spell level higher than
1st. The damage increases by 1d8 if the target is undead or a fiend." Three things stacked on
one hit, one decision, one slot spent (of whichever level you choose at the moment) — see if
that's discoverable, or if the tester either can't make the damage scale with the slot level at
all, or ends up spending more than one slot / double-charging the "vs. undead" part.

---

**Debrief question for the tester when done:** which task took the longest relative to how
complicated the underlying D&D rule actually is? That mismatch is the real signal.
