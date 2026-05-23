# Changelog — HtbaH-Modul + UX-Updates

Dieser Lauf hat das HtbaH-Regelwerk im Charakterbogen + Battle-Map weitgehend
abgebildet. Stand: 2026-05-23.

Quelle der Regeln: `docs/research/HTBaH_Regelreferenz.md` (offizielles
HtbaH-Wiki, Mai 2026).

---

## Übersicht der Commits (Reihenfolge: ältester → neuester)

| Commit    | Titel                                                                     |
| --------- | ------------------------------------------------------------------------- |
| `116fbed` | Kampfbogen: Waffenkategorien, Sonderregeln, Rüstungs-Slots                |
| `26777b9` | Fix 500: USelect empty-string → NONE_VALUE-Sentinel                       |
| `7d5aa53` | Krit-Treffer × 2 (§2.5/§10)                                               |
| `5247f5c` | MiniCharSheet Quick-Actions: Initiative-Anfrage + Parade                  |
| `10685df` | Rüstungs-Nebenwirkungen + erweiterte Waffeneigenschaften                  |
| `931f8a0` | Mobile/App-Modus: Vollbild-Karte + 2-Fenster + Bottom-Sheet               |
| `9627313` | Zustände als Auto-Modifikatoren (§4.2)                                    |
| `53618df` | Kampfmanöver-Buttons (§4.1)                                               |
| `5147f0d` | Zauberei-Modul (§8): Arkanum, Mana, Komplexitätswurf, 12 Lehren           |

---

## 1. Kampfbogen (Rüstung + Waffen)

### 1.1 Rüstung — Slot-basierte Verwaltung

**Datenmodell** (`shared/engines/htbah.ts`):

```ts
HtbahArmorPiece = {
  id, name,
  value: number,        // RW-Wert in HP-Punkten
  slot?: HtbahArmorSlot, // head/torso/shoulders/shield/hands/legs/feet/other
  tag?: HtbahArmorTag,   // leicht/mittel/schwer (Material-Klassifizierung)
  note?: string
}
```

**Berechnung**:

```
Gesamt-RW = Σ aller value-Felder (>= 0 geclampt)
htbahTotalArmor(data) = clamp(0, Σ piece.value)
```

Im Bogen: kompakter Slot+Tag-Dropdown pro Teil, Gesamt-Σ-RW-Badge oben.

### 1.2 Rüstungs-Nebenwirkungen (§6.2.3 erweitertes Modul)

| Wert         | Formel                          | Wo wirkt's                              |
| ------------ | ------------------------------- | --------------------------------------- |
| Parade-Bonus | `+RW`                           | Manuell als Modifier ODER Parade-Button |
| Init-Malus   | `−round(RW/10)` (kaufm. rund.)  | Automatisch in `htbahInitiativeBonus`   |
| Athletik-Malus | `−floor(RW/2)`                | Hinweis im Status-Panel (manuell)       |

```ts
htbahInitiativeBonus(data) = htbahTalentValue(data, 'handeln') - round(RW/10)
htbahArmorParadeBonus(data) = RW
htbahArmorAthleticsPenalty(data) = -floor(RW/2)
```

Beispiel RW 34: Parade +34, Init −3, Athletik −17.

Im Bogen erscheint ein Info-Block "🛡 Rüstungs-Effekte" sobald RW > 0.

### 1.3 Waffen — Kategorien & Sonderregeln

**Datenmodell**:

```ts
HtbahWeaponEntry = {
  id, name,
  damageFormula: string,        // NdM±X
  category?: HtbahWeaponCategory, // stumpf/hieb/stich/fernkampf/wurf/sonstige
  properties?: {
    schlagwaffe?: boolean,
    armorBreak?: number,
    aufspiessen?: boolean,
    huntingThreshold?: number,
    flink?: number, grob?: number,    // Trefferwurf Nahkampf
    genau?: number, schwer?: number,  // Trefferwurf Fernkampf
    schwert?: boolean,                // +5 Paradewurf
    stangenwaffe?: boolean,           // +10 Initiative
  },
  attackSkillId?: string,       // welcher Skill für den Trefferwurf?
  note?: string
}
```

**Wirkungen der Sonderregeln**:

| Property            | Effekt                                                                                                    | Wo wirkt's                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `schlagwaffe`       | Jeder gewürfelte 1er beim Schadenswurf darf einmal neu gewürfelt werden                                   | Server-seitig in `rollFree` via `htbahSchlagwaffeReroll`                |
| `armorBreak: X`     | Rüstungsbrechend: reduziert Ziel-RW um X (clamped >= 0)                                                   | Sowohl in Chat-Anzeige (`/rolls`) als auch in `/apply-damage` (HP-Abzug)|
| `aufspiessen`       | Krit-Bereich auf 20 % statt 10 % des FW; Krit-Treffer beschädigt Rüstung dauerhaft −1 RW                  | `htbahCritThresholdAufspiessen()` in der Probe; `aufspiessenCrit`-Flag im apply-damage senkt ersten Armor-Piece um 1 |
| `huntingThreshold: X` | Jagdwaffe: +15 auf Trefferwurf gegen Ziel mit Gesamt-RW ≤ X                                             | Server berechnet den Bonus aus dem Ziel-Token in `/rolls` (htbahSkill)   |
| `flink: X`          | +X auf Trefferwurf (Nahkampf)                                                                             | Im MiniCharSheet bei htbahSkill addiert (`htbahWeaponAttackBonus`)      |
| `grob: X`           | −X auf Trefferwurf (Nahkampf)                                                                             | Dito (subtrahiert)                                                       |
| `genau: X`          | +X auf Trefferwurf (Fernkampf)                                                                            | Dito                                                                     |
| `schwer: X`         | −X auf Trefferwurf (Fernkampf)                                                                            | Dito (subtrahiert)                                                       |
| `schwert`           | +5 auf Paradewurf, solange die Waffe ausgerüstet ist                                                      | Im Parade-Button-Wurf addiert (zusammen mit Rüstungs-Parade-Bonus)       |
| `stangenwaffe`      | +10 auf Initiative-Wurf                                                                                   | Server-seitig in `/initiative/roll` (Client schickt Flag mit)            |

**Kombinierte Trefferwurf-Formel** (htbahSkill mit selektierter Waffe):

```
Trefferwurf-Mod = (Spieler-Mod)
                + (Flink + Genau − Grob − Schwer)
                + (Self-Conditions-Mod, z.B. Blind −40, Frightened −40)
                + (Target-Conditions-Mod, z.B. Prone +20)
                + (Jagdwaffen-Bonus +15 falls Ziel-RW ≤ huntingThreshold)
                + (Wunden-Malus aus Schadensstufe, server-seitig)
```

---

## 2. Schadens- und Wurf-Mechanik

### 2.1 Kritischer Treffer × 2 (§2.5/§10)

```ts
// rollFree() in server/utils/dice.ts
if (input.critical) total = (sum + modifier) * 2
```

**Workflow**:

1. Spieler würfelt htbahSkill (Trefferprobe), Server liefert `critical: true` im Payload zurück.
2. MiniCharSheet trackt das in `probeResultLast`.
3. Nächster Schadenswurf passt `critical: true` mit, wenn Modus = `damage` und nicht Heilung.
4. Server verdoppelt die Endsumme, Payload bekommt `damageCrit: true`.
5. RollCard zeigt "✨ Krit. Treffer — Schaden ×2".
6. Krit-Flag wird nach dem Schadenswurf zurückgesetzt (Krit gilt nur für EINEN Treffer).

### 2.2 Krit-Schwellen

```ts
htbahCritThreshold(skillValue)            = max(1, floor(skillValue / 10))  // 10 %
htbahCritThresholdAufspiessen(skillValue) = max(1, floor(skillValue / 5))   // 20 %
htbahFumbleThreshold(skillValue)          = ceil(skillValue / 10) + 90      // obere 10 %
```

Krit nur bei Skill-Proben (nicht bei reinen Begabungsproben).

### 2.3 Schlagwaffen-Reroll

```ts
// pro Würfel des Schadenswurfs: ist es eine 1? → einmal neu würfeln
// Reroll-Liste wird transparent im Chat-Payload mitgesendet (schlagwaffeRerolls[])
```

### 2.4 DC-Schwierigkeits-Presets (§3.6)

Quick-Buttons im Probenwurf:

| Stufe        | Modifier |
| ------------ | -------- |
| Sehr leicht  | +30      |
| Leicht       | +15      |
| Normal       | ±0       |
| Schwer       | −15      |
| Sehr schwer  | −30      |
| Extrem       | −45      |

---

## 3. Zustände als Auto-Modifikatoren (§4.2)

Beim Probenwurf werden Conditions aus `Token.statusText` (CSV) automatisch
eingerechnet:

| Zustand (`id`)                           | Self-Effekt                  | Target-Effekt (vs.)           |
| ---------------------------------------- | ---------------------------- | ----------------------------- |
| `prone` (Liegend)                        | —                            | +20 für Angreifer             |
| `restrained` / `grappled`                | —                            | +20 für Angreifer             |
| `stunned` (Verwirrt/Betäubt)             | −20 auf JEDEN Wurf           | —                             |
| `blinded` (Blind)                        | −40 Trefferwurf/Parade       | —                             |
| `frightened` (Verängstigt)               | −40 Trefferwurf, −5 Schaden  | —                             |
| `unconscious` / `paralyzed` / `petrified` | −100 (Wurf praktisch unmöglich) | —                          |

**Implementation**:

```ts
htbahConditionMods(conditionIds: string[]): {
  selfAttack: number,        // wirkt nur bei Trefferwurf (Waffe gewählt)
  selfMod: number,           // wirkt auf JEDE Skill/Talent-Probe
  targetVsAttack: number,    // Bonus für Angreifer gegen dieses Ziel
  damageReduction: number,   // wird vom eigenen Schadenswurf abgezogen
  notes: string[],
}
```

MiniCharSheet liest `activeToken.statusText` (Self) und ggf. `damageTarget.statusText`
(Target), addiert die Modifikatoren zum Wurf und schreibt die Effekte transparent
ins Note-Feld (z.B. "Liegend (+20 vs.)", "Verängstigt (−40 Angr., −5 Schaden)").

---

## 4. Kampfmanöver (§4.1)

Neuer Button "Manöver" im MiniCharSheet öffnet Popup mit 6 vordefinierten
Manövern. Auswahl setzt `rollMod` + `rollNote` vor, der Spieler klickt danach
nur noch normal "Würfeln".

| Manöver                  | Mod  | Effekt-Notiz                                                |
| ------------------------ | ---- | ----------------------------------------------------------- |
| Sturmangriff             | −20  | 3× Bewegung, dann Angriff                                    |
| Angriff im Vorbeilaufen  | −10  | Gegner bekommt Gelegenheitsangriff                           |
| Entwaffnen               | ±0   | Krit = Waffe übernommen                                       |
| Zu Fall bringen          | ±0   | Krit = +1W10 Schaden                                          |
| Ringkampf                | +10  | Beide werden "Ringend" (Bonus wenn 2H frei)                  |
| Gegenstand zerstören     | ±0   | Krit = sofort zerstört                                       |

---

## 5. Initiative-Workflow

### 5.1 Datenmodell

```ts
InitiativeState = {
  active: boolean,
  round, currentIndex,
  entries: InitiativeEntry[],
  awaitingFromCharacters?: number[],  // characterIds, von denen noch Würfe ausstehen
}
```

### 5.2 SL-Workflow

1. SL klickt im Initiative-Tracker auf **"Anfrage an Spieler"**.
2. Server schreibt alle Spieler-Charakter-IDs (nicht-DM-Token mit characterId) in
   `awaitingFromCharacters` und pushed via Pusher.
3. Bei jedem Spieler erscheint im MiniCharSheet ein **roter Button "Initiative würfeln!"**.

### 5.3 Spieler-Wurf

`POST /api/groups/:id/initiative/roll`:

```
1W10 + htbahInitiativeBonus(data) + (stangenwaffeBonus ? 10 : 0)
       └─ = htbahTalentValue('handeln') − round(RW/10)
```

- Würfelt server-seitig.
- Schreibt Eintrag in `entries` (oder ersetzt existierenden des Chars).
- Entfernt `characterId` aus `awaitingFromCharacters`.
- Postet Roll-Message im Chat.

### 5.4 Parade/Ausweichen (§2.4)

Quick-Action-Button öffnet Popup mit:

- **Handeln-Begabung** (Default).
- Alle Skills, deren Name `/pari|ausweich|block|parade/i` matcht.

Klick → würfelt direkt mit `modifier = Rüstungs-Parade-Bonus + (Schwert ? +5 : 0)`,
Note "Parade/Ausweichen · Rüstung +X · Schwert +5".

Hinweis: Krit-Treffer und Schusswaffen sind nicht parierbar (im Popup angezeigt).

---

## 6. Magie-Modul "Zauberei" (§8)

Optionales Subsystem — `magicState.active` muss vom Spieler im Bogen aktiviert werden.

### 6.1 Datenmodell

```ts
HtbahMagicState = {
  active: boolean,
  mana: number,
  arkanum: number,                  // 0–5, Anzahl bekannter Zauber
  lehren: HtbahSpellLehreId[],      // max 3
}
```

### 6.2 Berechnungen

```
manaMax = arkanum × 2                            // §8.3
manaRegen = +1 pro Stunde Rast                   // §8.4

Komplexitätswurf = 3W10 + arkanum
Erfolg:           3W10 + arkanum >= Schwelle
Krit. Erfolg:     2+ Zehner im Wurf → KEIN Mana verbraucht
Krit. Misserfolg: 2+ Einser im Wurf → Mana verbraucht, KEIN Effekt
```

**Schwellen pro Stufe** (§8.2):

| Stufe | Schwelle | Mana-Kosten |
| ----- | -------- | ----------- |
| I     | 14       | 1           |
| II    | 16       | 2           |
| III   | 18       | 3           |
| IV    | 20       | 4           |
| V     | 22       | 5           |

### 6.3 Die 12 Lehren

`HTBAH_SPELL_LEHREN` enthält alle: Schutz · Genesung · Segen · Tiergestalt ·
Erdmagie · Trugbild · Verfall · Böser Blick · Fluch · Beherrschung · Sturm ·
Beschwörung.

Max 3 Lehren pro Charakter (im Bogen via Toggle-Buttons enforced).

### 6.4 Quick-Cast im MiniCharSheet

Neuer "Zaubern"-Button (nur bei aktivem Magie-Modul) öffnet Popup:

- Spruchname-Input
- Stufe-Select (zeigt Schwelle + Mana-Kosten)
- Optional: Lehre-Tag

Klick → `POST /api/groups/:id/magic/cast`:

- Validiert: Eigentum + Modul aktiv + Mana >= Kosten.
- Server würfelt 3W10, addiert Arkanum, wertet aus.
- Mana-Update direkt in `character.data.magicState.mana` geschrieben.
- Chat-Message wird gepostet (mit Krit/Erfolg/Misserfolg + Würfeln + neuer Mana).
- Popup zeigt das Ergebnis sofort.

---

## 7. UX: Mobile / App-Modus / 2-Fenster

### 7.1 App-Modus (Vollbild-Karte)

Toggle-Button im Karten-Header. Aktiviert eine globale CSS-Klasse
`app-mode-active` auf `<html>`, die:

- Layout-Header + Footer komplett ausblendet.
- Audio-Panel, Chat, Help-Text, inline MiniCharSheet, Resize-Handle hidden via
  `app-mode-hide`-Class.
- Karte nimmt volle Viewport-Höhe.
- Floating Action Button "Mein Sheet" unten rechts.
- Bottom-Sheet (Slide-up Drawer mit Backdrop + Drag-Handle) öffnet vollständiges
  MiniCharSheet (alle Quick-Actions, Würfler, Mana, Inventar).

Wird beim Verlassen der Seite automatisch aufgeräumt.

### 7.2 Zweites Fenster — `/groups/:id/play/:mapId`

Neue Route zeigt **nur das MiniCharSheet** im Vollbild. Synct via:

- Pusher Map-Channel (HP-Änderungen, Token-Updates)
- Pusher Group-Channel (Initiative-Freigabe)
- 8-Sekunden-Polling als Fallback

Im Battle-Map-Header öffnet der Button "Sheet-Fenster" diese Route per
`window.open(url, 'paperheros-sheet-{mapId}', 'width=420,height=900')` —
Smartphone-Hochformat-Aspect, ideal als Begleiter auf einem zweiten Display
oder Smartphone.

### 7.3 Mobile-CSS-Polish

`@media (max-width: 640px)`:

- `min-height: 32px` auf Buttons (Touch-Komfort).
- `min-height: 48px` auf `.roll-cta`-Hauptwürfeln-Buttons.
- `min-height: 36px` auf Inputs/Selects.
- `font-size: 16px` in Inputs → verhindert iOS-Auto-Zoom beim Focus.
- Größere `border-radius` + `padding` auf `.parchment-card`.

Bottom-Sheet nutzt `100dvh` (dynamic viewport units), damit die iOS-Safari-
Bottom-Bar nichts abschneidet.

---

## 8. Chat-Anzeige (RollCard)

Die RollCard zeigt für HtbaH-Würfe jetzt automatisch zusätzliche Felder, sofern
gesetzt:

| Feld                     | Anzeige                                          |
| ------------------------ | ------------------------------------------------ |
| `damageCrit`             | "✨ Krit. Treffer — Schaden ×2"                  |
| `armorBreak`             | "− Rüstung X (Rüstungsbrechend −Y)"              |
| `schlagwaffeRerolls`     | "🔨 Schlagwaffe-Reroll: 1→7, 1→3"                 |
| `huntingBonus`           | "🎯 Jagdwaffe +X (Ziel hat niedrige Rüstung)"     |
| `aufspiessen`            | "🗡 Aufspießen — Krit-Bereich verdoppelt"        |
| `targetArmor` + `finalDamage` | Vollständiger Schadens-Breakdown vs. Ziel    |

---

## 9. Server-Endpoints (neu)

| Pfad                                                | Zweck                                                |
| --------------------------------------------------- | ---------------------------------------------------- |
| `POST /api/groups/:id/initiative/roll`              | Spieler-Initiative-Wurf (W10 + Handeln − RW/10 + Stange?+10) |
| `POST /api/groups/:id/magic/cast`                   | Komplexitätswurf für Zauber (3W10 + Arkanum)         |
| `PUT  /api/groups/:id/initiative` *(erweitert)*     | InitiativeState bekommt `awaitingFromCharacters[]`   |
| `POST /api/groups/:id/maps/:mapId/tokens/:tokenId/apply-damage` *(erweitert)* | armorBreak + aufspiessenCrit (−1 RW dauerhaft) |
| `POST /api/groups/:id/rolls` *(erweitert)*          | htbahSkill: aufspiessen + huntingThreshold + targetTokenId; free: schlagwaffe + armorBreak + critical + weaponCategory |

---

## 10. Was noch nicht drin ist

- Pre-built Zauber-Katalog (alle 60 Sprüche aus §8.12 als One-Click-Add).
- "Regel der Drei"-LP-System (§7.2) und Universalkampfsystem (§3) als Alternativen.
- Magie-bannen-Workflow (§8.7) und Magie-erkennen-Wurf (§8.8) als dedizierte Buttons.
- Alternative Magiemodule (Fünfstufenmagie, Sonnen-Magie, Seelensplitter — §8.13).
- Schusswaffen-Distanz-Falloff bei Schrotflinten (§5.1 Hinweis).
- Automatisches Blut-Tick (Blutend n LP / Runde, kumulativ — §4.2) — aktuell als Sticker, ohne Auto-Decrement.
