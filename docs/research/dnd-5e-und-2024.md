# D&D 5e (2014) und D&D 2024 (5.5e) — Charakterbogen + Berechnungen

## 1. Charakterbogen-Felder

### Stammdaten
- `name`, `species`/`race` (2024: Species, 2014: Race)
- `class` + `subclass` — Multiclass: Liste von `{class, level, subclass}`
- `background`
- `level` (1–20, Summe der Klassen-Levels)
- `xp` — 1=0, 2=300, 3=900, 4=2700, 5=6500, 6=14000, 7=23000, 8=34000, 9=48000, 10=64000, 11=85000, 12=100000, 13=120000, 14=140000, 15=165000, 16=195000, 17=225000, 18=265000, 19=305000, 20=355000
- `alignment` (LG/NG/CG/LN/N/CN/LE/NE/CE) — 2024: optional
- `playerName`, `inspiration` (2014: bool; 2024: `heroicInspiration` — jeden Würfel rerollen)

### Attribute
Sechs Werte: `STR`, `DEX`, `CON`, `INT`, `WIS`, `CHA` — Range 1–30 (PCs typ. 3–20).
Pro Attribut: `score`, `modifier` (derived), `savingThrowProficient`, `savingThrow` (derived).

### 18 Skills (identisch 5e und 2024)
| Skill | Attribut | | Skill | Attribut |
|---|---|---|---|---|
| Acrobatics | DEX | | Investigation | INT |
| Animal Handling | WIS | | Medicine | WIS |
| Arcana | INT | | Nature | INT |
| Athletics | STR | | Perception | WIS |
| Deception | CHA | | Performance | CHA |
| History | INT | | Persuasion | CHA |
| Insight | WIS | | Religion | INT |
| Intimidation | CHA | | Sleight of Hand | DEX |
| | | | Stealth | DEX |
| | | | Survival | WIS |

Pro Skill: `proficient`, `expertise`, `bonus` (custom), `value` (derived).

### Kampfwerte
- `armorClass`, `initiative`, `speed` (walk/swim/fly/climb/burrow)
- `hitPointMaximum`, `currentHitPoints`, `temporaryHitPoints`
- `hitDice` ({total, used, dieType pro Klasse})
- `deathSaves` (successes 0–3, failures 0–3)
- `conditions[]` + exhaustion-level

### Angriffe & Zauber
- `attacks[]`: `{name, attackBonus, damage, damageType, range, properties[], mastery (2024)}`
- `spellcasting`: `{ability, saveDC, attackBonus, spellsKnown[], spellsPrepared[], spellSlots: {1..9: {total, used}}}`

### Inventar & Sonstiges
- `equipment[]`: `{name, qty, weight, equipped, attuned}`
- `currency`: `{cp, sp, ep, gp, pp}`
- `languages[]`, `tools[]`, `weaponProficiencies[]`, `armorProficiencies[]`
- `features[]`: `{name, source, description, uses}`
- `feats[]` (2024: origin/general/fighting-style/epic-boon)

### Roleplay
- `personalityTraits`, `ideals`, `bonds`, `flaws`
- `appearance`, `backstory`, `alliesOrganizations`

## 2. Berechnungsformeln

```
abilityModifier(score)   = floor((score - 10) / 2)
proficiencyBonus(level)  = 2 + floor((level - 1) / 4)
  // Lvl 1-4: +2 | 5-8: +3 | 9-12: +4 | 13-16: +5 | 17-20: +6

skillBonus     = abilityMod + (proficient ? PB : 0) + (expertise ? PB : 0) + miscBonus
saveBonus      = abilityMod + (proficient ? PB : 0) + miscBonus
passiveSkill   = 10 + skillBonus
initiative     = DEX_mod  (+ PB falls 2024-Klassenfeature)

unarmored        = 10 + DEX_mod
lightArmor       = armor.base + DEX_mod
mediumArmor      = armor.base + min(DEX_mod, 2)
heavyArmor       = armor.base
shield           = +2
unarmoredDefense:
  Barbarian      = 10 + DEX_mod + CON_mod
  Monk           = 10 + DEX_mod + WIS_mod
  Mage Armor     = 13 + DEX_mod

HP_level1   = hitDieMax + CON_mod
HP_levelN   = HP_level(N-1) + roll(hitDie) + CON_mod
HP_average  = HP_level(N-1) + (hitDie/2 + 1) + CON_mod

meleeAttack       = STR_mod + (proficient ? PB : 0) + magicBonus
finesseOrRanged   = max(STR_mod, DEX_mod) + (proficient ? PB : 0)
damage            = weaponDie + abilityMod + magicBonus
spellSaveDC       = 8 + PB + spellcastingMod
spellAttackBonus  = PB + spellcastingMod

carryingCapacity = STR * 15  (lbs)
```

Hit Dice pro Klasse:
- d6: Sorcerer, Wizard
- d8: Bard, Cleric, Druid, Monk, Rogue, Warlock, Artificer
- d10: Fighter, Paladin, Ranger
- d12: Barbarian

Death Saves: bei 0 HP 1d20/Zug; ≥10 Success, ≤9 Fail; 1=2 Fails, 20=1 HP+Conscious; 3 Successes stabil, 3 Fails tot.

## 3. Unterschiede 5e (2014) ↔ 2024

| Bereich | 5e 2014 | 2024 |
|---|---|---|
| Inspiration | bool, d20 reroll vor Wurf | Heroic Inspiration: jeden Würfel rerollen, nach Wurf |
| Background | 2 Skills, Tools, Sprachen, Feature | 2 Skills, 1 Tool, 1 Sprache, **Origin Feat** + ASI |
| Race/Species | Race gibt ASI | Species: keine ASI (kommt vom Background), nur Traits |
| Feats | nur General (statt ASI ab 4) | Origin / General / Fighting Style / Epic Boon |
| Weapon Mastery | — | Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex |
| Spell Prep | Cantrips separat, einige "known" | "Prepared" einheitlicher; Cantrips ersetzbar bei Level-up |

## 4. Quellen (CC-BY-4.0)
- [SRD 5.2 (2024)](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.pdf)
- [SRD 5.1 (2014)](https://dnd.wizards.com/resources/systems-reference-document)
- [5thsrd.org](https://5thsrd.org/) / [5e24srd.com](https://5e24srd.com/)
- [dnd5e.wikidot.com](http://dnd5e.wikidot.com/) / [dnd2024.wikidot.com](http://dnd2024.wikidot.com/)

**Lizenz-Hinweis:** SRD-Inhalte unter CC-BY-4.0 mit Attribution-Block. PHB-exklusive Inhalte (viele Subklassen, viele Spells, Lore) NICHT verwenden — User-Input zulassen.
