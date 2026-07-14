/** Curated formula presets for common scaling patterns. */

import { isDarkTheme } from "../theme.mjs";

const PRESETS = [
  {
    label: "Extra dice, scaling with upcast levels",
    formula: "(1 + @scaling.increase)d6",
    hint: "0 extra dice at base level, +1d6 per slot upcast. Layers cleanly on top of a spell's own native scaling.",
  },
  {
    label: "Extra dice, scaled to the level actually cast",
    formula: "(@item.level)d6",
    hint: "Dice count equals the spell's actual cast level (already includes upcasting). Don't combine with the option above, they'd double-count.",
  },
  {
    label: "Extra dice equal to proficiency bonus",
    formula: "(@attributes.prof)d6",
    hint: "Dice count equals your current proficiency bonus (2 at level 1–4, 3 at 5–8, ...).",
  },
  {
    label: "Extra dice scaled to an ability modifier",
    formula: "(max(@abilities.wis.mod, 0))d6",
    hint: "Swap wis for the relevant ability. Wrapped in max(...,0) so a 0-or-negative modifier gives 0 dice instead of breaking the roll. A bare @abilities.wis.mod as the dice count would fail if the modifier ever went to 0 or below.",
  },
  {
    label: "Flat bonus, scaling with upcast levels",
    formula: "@scaling.increase",
    hint: "0 at base level, +1 per slot upcast: a growing number, no dice, no parentheses needed.",
  },
  {
    label: "Flat bonus equal to character level",
    formula: "@details.level",
    hint: "Total character level (Character actors only, not NPCs).",
  },
  {
    label: "Flat bonus, half character level (rounded down)",
    formula: "floor(@details.level / 2)",
    hint: "Common \"scales every other level\" pattern: 0 at levels 1, 1 at levels 2-3, 2 at levels 4-5, etc.",
  },
  {
    label: "Flat bonus, half proficiency bonus (rounded up)",
    formula: "ceil(@attributes.prof / 2)",
    hint: "The Jack of All Trades-style half-proficiency pattern.",
  },
  {
    label: "Flat bonus equal to an ability modifier",
    formula: "@abilities.cha.mod",
    hint: "Swap cha for the relevant ability, e.g. @abilities.wis.mod for a Wisdom-based feature.",
  },
  {
    label: "Flat bonus equal to your spellcasting ability modifier",
    formula: "@attributes.spell.mod",
    hint: "Uses whichever ability the actor casts spells with, instead of naming one ability directly.",
  },
  {
    label: "Flat bonus, higher of two ability modifiers",
    formula: "max(@abilities.str.mod, @abilities.dex.mod)",
    hint: "Common for finesse-style features. Swap in whichever two abilities apply.",
  },
];

/**
 * @param {HTMLButtonElement} button The "Insert scaling..." trigger.
 * @param {HTMLInputElement} input Formula field to insert into.
 */
export function attachFormulaPresetButton(button, input) {
  if (!button || !input || button.dataset.cbPresetBound) return;
  button.dataset.cbPresetBound = "1";

  let list = null;

  const position = () => {
    if (!list) return;
    const r = button.getBoundingClientRect();
    list.style.left = `${r.left}px`;
    list.style.top = `${r.bottom + 4}px`;
  };

  const onOutside = (ev) => {
    if (list && !list.contains(ev.target) && ev.target !== button) close();
  };

  function close() {
    if (!list) return;
    document.removeEventListener("mousedown", onOutside, true);
    window.removeEventListener("scroll", position, true);
    window.removeEventListener("resize", position);
    list.remove();
    list = null;
  }

  function insert(preset) {
    const caret = input.selectionStart ?? input.value.length;
    const selEnd = input.selectionEnd ?? caret;
    const before = input.value.slice(0, caret);
    const after = input.value.slice(selEnd);
    input.value = before + preset.formula + after;
    const newCaret = before.length + preset.formula.length;
    input.setSelectionRange(newCaret, newCaret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    close();
    input.focus();
  }

  function render() {
    list.innerHTML = "";
    for (const preset of PRESETS) {
      const li = document.createElement("li");
      li.className = "case-by-case-preset-item";
      const code = document.createElement("code");
      code.textContent = preset.formula;
      const text = document.createElement("div");
      text.className = "case-by-case-preset-text";
      const label = document.createElement("span");
      label.className = "case-by-case-preset-label";
      label.textContent = preset.label;
      const hint = document.createElement("small");
      hint.className = "case-by-case-preset-hint";
      hint.textContent = preset.hint;
      text.append(label, hint);
      li.append(code, text);
      li.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        insert(preset);
      });
      list.appendChild(li);
    }
  }

  function open() {
    if (list) { close(); return; } // Toggle.
    list = document.createElement("ul");
    list.className = `case-by-case case-by-case-autocomplete-list case-by-case-preset-list ${isDarkTheme() ? "case-by-case-theme-dark" : "case-by-case-theme-light"}`;
    document.body.appendChild(list);
    render();
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    // Defer the outside-click listener so the opening click does not close the menu.
    setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  }

  button.addEventListener("click", (ev) => {
    ev.preventDefault();
    open();
  });
}