# Changelog — HtbaH-Modul + UX-Updates

Dieser Lauf hat das HtbaH-Regelwerk im Charakterbogen + Battle-Map weitgehend
abgebildet. Stand: 2026-05-24.

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
| `5725bce` | Changelog-Doku                                                            |
| `662e215` | Changelog im UI sichtbar (für alle)                                       |
| `851a941` | Spell-Katalog + Magie bannen/erkennen + Auto-Blutung + Schuss-Falloff + Impressum/Datenschutz |
| `2af0647` | Alternative Module: Regel der Drei, Universalkampf, 3× Magie              |
| `7d6e0ce` | Sheet-Fenster-Dropdowns + neues Chat-Popup-Fenster                        |
| `8e97c04` | FAB-Button „Mein Sheet" → „Mein Character"                                |
| `0b5b63b` | Zauber-Wirken: Mehrfach-Ziele + Auto-Schaden/Heilung                      |
| `376077e` | Battle-Map: Token wandert statt zu springen                               |
| `2491e4f` | Entfernung zum Ziel berechnen + Reichweite durchsetzen                    |
| `27c0bf8` | Mana im Status-Feld + Auffüllen                                           |
| `a646d36` | Verwendbare Gegenstände können auch Mana spenden                          |
| `7e7a896` | Token: Mana-Chip + gebogener Name + Heil-Item-Bug-Fix                     |
| `6a39139` | Token-Name: flacherer Bogen (Zwischenschritt)                             |
| `e32756b` | Token-Name: gerade über dem Token, ein Wort pro Zeile                     |
| `19aaf73` | Überlappende Tokens als 1/N-Streifen (vertikal getrennt)                  |
| `2757c58` | Nacht-Sicht zeigt Spieler-Sichtkreis + Benutzername editierbar            |
| `1b23e26` | Initiative-Tracker: Bilder werden wieder korrekt geladen                  |

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

## 11. Spell-Katalog (§8.12) — alle 60 Sprüche als One-Click-Lern-Liste

`shared/engines/htbah-spell-catalog.ts` enthält den kompletten Katalog —
12 Lehren × 5 Stufen = 60 Sprüche mit Name, Reichweite, Mana-Kosten,
Effekt-Beschreibung und Aufladbar-Flag.

**Datenmodell-Erweiterung**:

```ts
HtbahMagicState.knownSpellKeys?: string[]   // <lehre>:<stufe>:<slug>
```

**Im Charakterbogen** (Magie-Sektion → Sprüche aus Katalog):

- Pro aktivierter Lehre erscheinen alle 5 Stufen als Toggle-Buttons.
- Klick = lernen / verlernen. Max 5 gelernte Sprüche (= Arkanum).
- Arkanum wird automatisch auf `knownSpellKeys.length` gesetzt.
- Mana max = Arkanum × 2 wird neu berechnet, Mana current entsprechend
  geclampt.
- Gelernte Sprüche werden visuell mit Akzent-Farbe hervorgehoben.

**Im Mini-CharSheet Quick-Cast**:

- Wenn der Spieler Sprüche gelernt hat, erscheint ein zusätzliches
  Dropdown „Gelernter Spruch" vor dem freien Spruchnamen-Feld.
- Auswahl pre-füllt automatisch Spruchname + Stufe + Lehre.
- Sentinel `__free__` lässt freie Eingabe zu.

---

## 12. Magie bannen (§8.7) + Magie erkennen (§8.8)

**Magie erkennen** (`POST /api/groups/:id/magic/detect`):

```
1W10 + Arkanum >= 7  →  Magie erkannt (kein Mana-Verbrauch)
```

- Eigener Button im Magie-Quick-Cast-Popup unten.
- Kostet **kein Mana** (anders als reguläre Sprüche).
- Postet Roll-Message im Chat.

**Magie bannen** (`POST /api/groups/:id/magic/dispel`):

```
Wirker: 1W10 + Arkanum (kostet 1 Mana)
Ziel:   1W10 + Arkanum (kostet 1 Mana, wenn Ziel-Charakter mit aktivem Magie-Modul)
Wirker >= Ziel  →  Magie gebannt
```

- Eigener Button im Magie-Quick-Cast-Popup.
- Wirker zahlt **immer 1 Mana**, unabhängig vom Ergebnis (Regelwerk).
- Bei aktivem Ziel-Charakter: Ziel zahlt ebenfalls 1 Mana (Server zieht das
  automatisch ab).
- Ties gehen an den Wirker (pragmatische Auslegung).

---

## 13. Auto-Blutung-Tick (§4.2)

Vor dem Übergang in eine neue Initiative-Runde ruft der SL-Tracker
automatisch `POST /api/groups/:id/maps/:mapId/tick-bleed` auf:

1. Server sucht alle Token auf der Karte mit `bleeding`-Condition im
   `statusText`.
2. Liest pro Token den Counter `bleed:N` aus den Custom-Labels des
   statusText (Default 1, wenn nicht vorhanden).
3. Subtrahiert **N LP** vom Token (Charakter-HP oder NPC-HP).
   Rüstung wirkt **nicht** — die Wunde blutet von innen.
4. Inkrementiert den Counter auf `bleed:(N+1)` und schreibt ihn zurück.

→ Erste Blutungsrunde: −1 LP. Zweite: −2 LP. Dritte: −3 LP. (Kumulativ
laut Regelwerk.)

Soll die Blutung enden, muss der SL die `bleeding`-Condition vom Token
entfernen (z.B. nach erfolgreichem Erste-Hilfe-Wurf).

---

## 14. Schusswaffen-Distanz-Falloff (§5.1 Hinweis)

Zwei neue Waffeneigenschaften im Datenmodell:

```ts
HtbahWeaponProperties.falloffStart      // Vollschaden bis X Meter
HtbahWeaponProperties.falloffPerMeter   // Schaden-Abzug pro Meter darüber
```

**Beispiel** Schrotflinte: `{ falloffStart: 5, falloffPerMeter: 5 }` —
bis 5 m Vollschaden, danach −5 Schaden pro Meter.

Im Charakterbogen als zwei zusätzliche Number-Inputs im Waffen-Editor.
Die Verrechnung beim Schadenswurf bleibt aktuell SL-seitig — der
Spieler trägt die Distanz selbst als Modifier ein (siehe Notizfeld
beim Wurf).

---

## 15. Impressum + Datenschutz

Zwei neue Doku-Seiten — sichtbar im Footer beider Layouts (default + wide),
auch für nicht-eingeloggte Besucher:

- `/impressum` — privater, nicht-kommerzieller Verantwortlichen-Hinweis
  (§5 DDG). Lizenz-Hinweise für HtbaH, D&D-SRD, DSA.
- `/datenschutz` — DSGVO-konforme Datenschutzerklärung. Schlank
  gehalten: nur Account/Session-Cookies/Spieldaten, keine Tracker,
  keine Analytics. Drittanbieter-Hinweise zu Vercel, Pusher, Anthropic.

Die `changelog-prose`-Styles wurden aus `pages/changelog.vue` in
`assets/css/main.css` extrahiert und sind jetzt global verfügbar — alle
drei Doku-Seiten teilen sich dasselbe Markdown-/Prosa-Styling.

---

## 16. Alternative LP- und Kampfmodule (§3 + §7.2)

Pro Charakter im Bogen aktivierbar — Module sind nicht parallel nutzbar,
aber Wechsel ist verlustfrei (Felder bleiben am Datenmodell, werden nur
ein-/ausgeblendet).

### 16.1 Regel der Drei (§7.2)

Datenmodell:

```ts
HtbahCharacterData.rdd?: {
  active, mortality (1-10),
  current: { lebenspunkte, geistigeGesundheit, prestige },
  max:     { lebenspunkte, geistigeGesundheit, prestige },
  wounds: HtbahRddWound[],
}
```

Berechnungen (alle als Engine-Helper):

```
Basiswert pro Skala  = Geistesblitzpunkte(Kategorie) + 1
Punkte-Budget        = (Mortalität − 1) × 9
Max-Abstand          = Mortalität × 3
Schlaf-Regeneration  = round((Σ max) × Mortalität / 10)
Aktive Heilung (1×/Tag): wenig / mittel / viel
Schaden → Slots:     1-2W10=1, 3-4W10=2, 5-6W10=3, 7-8W10=4, 9+=5
Faustregel:          1 RdD-LP ≈ 9 Standard-LP
```

Wunden-Schwellen (§7.2.6) sind als Konstante `HTBAH_RDD_WOUND_THRESHOLDS`
hinterlegt; `htbahRddCheckWound(mortality, attackRoll)` liefert
`'temporary' | 'permanent' | undefined`.

**Im Bogen** (Status-Sektion):

- Toggle „Regel der Drei" aktiviert das Modul, ersetzt die LP-Anzeige.
- Mortalitäts-Input (1-10) + Live-Anzeige des Punkte-Budgets, Max-Abstand,
  Schlaf-Regen und aktive Heilung.
- Drei Skalen-Reihen mit current/max + „Auffüllen"-Button pro Skala.
- Wunden-Liste: Skala + Typ (temporär/dauerhaft) + Schadens-Slots + Notiz.

**Im MiniCharSheet**: bei aktivem Modul wird die HP-Bar durch drei farb­
codierte Skalen-Balken ersetzt (rot/lila/blau).

### 16.2 Universalkampfsystem (§3)

Pro Charakter:

```ts
HtbahCharacterData.combatModule?: 'standard' | 'universal'  // Default 'standard'
```

Engine-Helper (§3.1/§3.2):

```ts
htbahUniversalDamage({ talentValue, attackRoll, weaponKind, armorKind })
  // Schaden = (Talent − Wurf) / (WaffenMod + RüstungsMod)
  // Min 10 LP bei Treffer; max combinedMod = 4

htbahUniversalKonterdifferenz(defenderTalentValue, defenderRoll)
  // = Talent(V) − Würfelaugen(V); positiv = Aggressor erschwert

htbahUniversalAreaDamage({ roll, distanceMeters, basePower=100 })
  // 1m: base − roll; pro weiterem m: −10
```

Waffen-Mod: Schusswaffe 1, Handwaffe 2, waffenlos 3.
Rüstungs-Mod: keine 0, leicht 1, schwer 2.

**Im Bogen**: Toggle „Universalkampf" neben „Regel der Drei".

**Im MiniCharSheet**: bei aktivem Modul zusätzlicher Quick-Rechner über
der Damage-Sektion — Talent/Wurf/Waffen-Art/Rüstungs-Art eingeben →
Live-Schaden mit Mod-Anzeige. Der klassische NdM±X-Wurf bleibt parallel
nutzbar (Spieler kann frei wählen welchen Modus er für welchen Treffer
einsetzt).

---

## 17. Alternative Magiemodule (§8.13)

Magie-State bekommt ein `module`-Feld; je nach Wert blendet der Bogen den
passenden Block ein:

```ts
HtbahMagicState.module: 'zauberei' | 'fuenfstufen' | 'sonnen' | 'seelensplitter' | 'frei'
```

**Zauberei** (Default, §8 — bereits beschrieben in Abschnitt 6).

**Fünfstufenmagie** (§8.13.1):

```
Kontingent = Magie-Punkte / 5
Belegte Slots = Σ (stufe × charges) aller vorbereiteten Sprüche
Vorbereiten: 1 h Rast pro Spruch
Beim Wirken: Charge eines Spruchs wird verbraucht
```

Datenmodell: `fsMagiePunkte`, `fsVorbereitet[{name,stufe,charges}]`.
Im Bogen: Eingabe Magie-Punkte + Liste vorbereiteter Sprüche mit Stufe
und Charges. Slot-Anzeige live (`belegt/Kontingent`).

**Sonnen-Magie** (§8.13.2):

```
Aufladerunden = Zauberstufe ÷ 2 + 1
Konzentration: Default 70, pro Unterbrechung −10
Strahlenbündel lvl X: X·W10 + ⌊X/3⌋·W5
Sphären-Radius lvl 1-5: 3, 10, 20, 35, 50 m
```

Datenmodell: `sonnenKonzentration` (0-100).
Im Bogen: Konzentrations-Tracker mit Reset-Button auf 70.
Engine: `htbahSonnenChargeRounds`, `htbahSonnenStrahlenbuendel`, `htbahSonnenSphaerenRadius`.

**Seelensplittermagie** (§8.13.3):

```
Mind. 1 % Seele pro Zauber
Vor JEDER Probe: W100 ≤ verbraucht% → Schreckens-/Todesvision
> 99 % verbraucht → Charakter gilt als (vermutet) tot
```

Datenmodell: `seeleVerbraucht` (0-100).
Im Bogen: Slider/Input für %; Warn-Badge „💀 KRITISCH" ab > 99 %;
Fortschrittsbalken mit Rot-Gradient.

**Im MiniCharSheet Quick-Cast**: Header + Hinweistext zeigt das aktive
Modul mit modul­spezifischer Erinnerungs-Box (Konzentration / Kontingent /
Seelen-Verbrauch). Komplexitätswurf-Pflicht bleibt für Zauberei + Sonnen;
für Fünfstufen / Seelensplitter pflegt der Spieler den Spruch frei.

---

## 19. Magie-Targeting + Reichweiten (2026-05-24)

### 19.1 Zauber-Wirken mit Mehrfach-Zielen

Das Komplexitätswurf-Popup (§8.5) hat jetzt einen Block „Ziele & Wirkung":

- `USelectMenu` (multi) auf alle Tokens der Karte
- Modus Schaden/Heilung + freie NdM±X-Formel
- Auto-Fill aus dem Katalog: erstes `NW10[±X]`-Muster aus dem Effekt-Text;
  Heil-Modus automatisch für Lehre *Genesung*
- Toggle „Pro Ziel separat würfeln" (Default: ein AoE-Wurf für alle)
- Bei Erfolg → pro Ziel eigene Roll-Card (`Spruch → Ziel`) + `apply-damage`
  (Rüstung serverseitig); Ergebnis-Zeilen unter dem Popup

Misserfolg oder Krit-Misserfolg → kein Auto-Schaden, nur Mana-Kosten.

### 19.2 Entfernung zum Ziel berechnen + Reichweite durchsetzen

Neuer Helper `shared/distance.ts`:

```ts
chebyshevTiles(a, b, gridSize) // Felder zwischen zwei Token-Mittelpunkten
parseHtbahRangeTiles(text)     // "Berührung"=1, "Selbst"=0, "30 m"=30, "Sicht"=∞
```

Skala: **1 Feld = 1 m** (passt zu HtbaH-Reichweiten in Metern).

Im MiniCharSheet:

- Ziel-Dropdowns zeigen Distanz: `Goblin · 12/14 · 3 Felder` / `· 1 Feld` / `· selbes Feld`
- **Nahkampf** (Waffenkategorie ≠ fernkampf/wurf): Probe + Schaden geblockt,
  wenn Ziel > 1 Feld weg
- **Zauber-Wirken**: Katalog-Reichweite wird geparst; Wirken-Button geblockt,
  wenn ein gewähltes Ziel außerhalb liegt
- **DM-Override**: Spielleiter darf trotz Reichweiten-Verstoß würfeln
  (Storytelling-Edge-Cases); Spieler sehen rote Warnung + deaktivierten Button

`battle/[mapId].vue` + `play/[mapId].vue` reichen `gridSize` + `isDm` als
neue Props an MiniCharSheet durch.

### 19.3 Mana im Status-Feld + Auffüllen

Im HtbaH-Bogen, sobald das Magie-Modul aktiv ist:

- Mana-StatBlock neben LP/Initiative (`aktuell/max`, Arkanum als Sublabel)
- Editierbares Mana-Input + read-only Max-Anzeige + **Auffüllen**-Button
  (sofort auf `htbahManaMax(arkanum)`)

Bei deaktiviertem Magie-Modul unsichtbar — Layout fällt von 3-spaltig auf
2-spaltig zurück.

### 19.4 Verwendbare Gegenstände können auch Mana spenden

`HtbahUsableItem` bekommt ein optionales `manaAmount`-Feld. Ein Item kann
HP heilen, Mana spenden — oder beides (z.B. Lebenselixier).

- **Server**: `POST /apply-mana` spiegelt `/apply-damage` (group-member-Auth,
  server-clamped via `htbahManaMax`). Bei NPC oder ohne Magie → `applied: 0`
  (kein harter Fehler, HP-Effekt + Anzahl-Reduktion laufen weiter)
- **Client**: `useItem` ruft pro Item beide Endpoints (jeweils nur wenn > 0),
  eine gemeinsame Chat-Card mit beiden Werten im Label
  (`Verwende X · ✚N HP · ✦M Mana`); Ergebnis-Zeile zeigt beide Deltas
- **Bug-Fix Heil-Self**: der nachgelagerte PUT (quantity−1) hat vorher den
  Vor-Heilungs-Snapshot von `character.value` zurückgeschrieben und damit
  die frische HP überschrieben. Jetzt: Charakter vor dem PUT neu laden,
  wenn das Ziel der eigene Charakter ist

---

## 20. Battle-Map UX-Iteration (2026-05-24)

### 20.1 Token-Bewegung als Walk-Animation

Statt einem harten Sprung sehen Mitspieler jetzt eine 400 ms-Animation von
alter zu neuer Position (`cubic-bezier(0.4, 0, 0.2, 1)` auf `left` + `top`).
Eigener Drag bleibt lag-frei via `token-dragging`-Opt-out. Respektiert
`prefers-reduced-motion`.

### 20.2 Mana/Fokus am Token

Server liefert `mana`/`manaMax` pro Token mit, wenn der gekoppelte HtbaH-
Charakter Magie aktiv hat. Battle-Map rendert einen kleinen lila
`✦ N/M`-Chip direkt unter dem HP-Chip. NPCs ohne Magie bekommen keinen
Chip. `hpVisibleToPlayers=false` versteckt auch Mana (DM-Geheimnis).

### 20.3 Gerader Namen-Stack über dem Token

Der erste Versuch (gebogener SVG-`textPath` als Halbkreis) wickelte den
Namen um den Token, äußere Buchstaben standen quer. Iteration 2 (flacher
Bogen, R = 4× Token-Radius) blieb winzig und unlesbar. Finale Lösung:
gerade gestapelt, jedes Wort eigene Zeile, weiß mit dickem schwarzen
Outline. *„Waldthane Alvinur Tatzelmoos"* wird damit zu drei lesbaren
Zeilen direkt über dem Token. Arc-Helper sind komplett raus.

### 20.4 Überlappende Tokens als 1/N-Streifen

Stehen zwei oder mehr Tokens auf demselben Rasterfeld, wird jedes auf einen
vertikalen `clip-path: inset(...)`-Streifen geclippt:

- 2 Tokens → zwei Halbkreise nebeneinander
- 3 Tokens → drei Lamellen
- N Tokens → 1/N

Gruppierung über gesnappte Tile-Koordinaten; im Drag befindliche Tokens
sind ausgenommen (sonst Pixel-Flackern). DOM restrukturiert: Wrapper hält
nur Position + Click-Handler, ein innerer Visual-`<div>` trägt
Border + Bild + Wund-Schleier + Tot-X und bekommt den Clip — Badges, HP-/
Mana-Chip und Namen-Stack liegen außerhalb und bleiben vollständig
sichtbar.

### 20.5 Nacht-Sicht zeigt Spieler-Sichtkreis

`visionPolygons` war an `map.fogEnabled` gebunden — bei aktivierter Nacht
ohne FoW kam die Nacht-Maske ohne Sicht-„Löcher" raus, der Spieler sah
pitch black. Fix: Polygone werden auch berechnet, wenn die aktuelle
Tageszeit eine Sicht-Mask braucht (`currentTodOverlay.requiresVisionMask`).

### 20.6 Initiative-Tracker: Bilder wieder geladen

Server-Roll-Handler speicherte den rohen `battleTokens.imageUrl` im
Initiative-Eintrag — bei Charakter-Tokens oft `null`, sonst ein privater
Blob-URL, den der Browser nicht direkt laden kann. Fix: URL über den
authentifizierten `/api/groups/.../tokens/<id>/image`-Endpoint bauen
(proxyt private Blobs, fällt auf Charakter-Portrait zurück). Ohne Token
auf einer Karte: Fallback `/api/portrait/<charId>`. Zusätzlich
Client-`@error`-Handler → neutrales User-Icon statt broken-image-Glyph
für Alt-Einträge.

---

## 21. Profil

Spieler können ihren Benutzernamen jetzt im Profil ändern. Inline-Editor
mit Pencil-Button neben dem Namen, Speichern/Abbrechen, kurze
„✓ gespeichert"-Bestätigung. Server-Endpoint
`POST /api/profile/change-username` validiert (3–40 Zeichen, unique-Check
gegen andere User) und aktualisiert die Session, damit Header + Profil
sofort den neuen Namen zeigen.

---

## 22. Sichtlinie + Restrückstände (2026-05-24)

### 22.1 Fernkampf + Magie brauchen Sichtlinie

Neuer Helper `canSeeTargetForAttack` in `shared/distance.ts`:

- **Tag**: direkte Sichtlinie über `segmentBlockedByWalls` aus `fog.ts` —
  Mauer dazwischen blockt.
- **Nacht**: zusätzlich muss das Ziel beleuchtet sein — im eigenen
  Sichtkreis des Angreifers oder in einer Karten-Lichtquelle (Fackel,
  Lagerfeuer). Jede Quelle wird per Radius + Mauer-Pruefung getestet.

Battle-Map + Play-Page sammeln Walls + Lichter und reichen die Funktion
als `canSee`-Prop an MiniCharSheet. Dort wird sie für Fernkampf-
(Bogen/Schusswaffe/Wurf) und Cast-Ziele ausgewertet:

- Spieler: Würfeln/Wirken-Button geblockt + rote Warnung.
- DM: nur gelbe Warnung, darf weiter würfeln.

### 22.2 Universalkampf-Schaden direkt anwenden

Der Universalkampf-Rechner (§3.2) zeigt nicht mehr nur das Ergebnis —
darunter ein Ziel-Dropdown + „Schaden anwenden"-Knopf, der via
`apply-damage` direkt am Token wirkt (Rüstung serverseitig). Posten
einer Chat-Card mit der Rechnungsspur (`T − W / Mod`).

### 22.3 Seelensplittermagie: Auto-Vision-Wurf

Beim Komplexwurf in Seelensplitter-Modus wirft die UI jetzt
automatisch W100 ≤ `seeleVerbraucht`% vor dem eigentlichen Cast. Wenn
es triggert, postet die UI eine rote Chat-Card („💀 Vision ausgelöst")
und zeigt im Popup ein dauerhaftes Indikator-Banner. Der Cast läuft
trotzdem — die narrative Konsequenz trägt der DM.

---

## 18. Was noch offen ist

Alle MD-Punkte aus dem Regelwerk sind jetzt abgebildet — entweder
strukturiert mit Auto-Würfen oder als Tracker, der SL-Hand-Würfe
unterstützt.

Mögliche Erweiterungen für später:

- Pre-built Zauber-Kataloge auch für Fünfstufen/Sonnen/Seelensplitter
  (analog zum bestehenden Zauberei-Katalog mit allen 60 Sprüchen).
  → Bewusst offen gelassen: dafür braucht es die Spruchtexte aus dem
  Regelwerk; ohne Quelle wäre der Inhalt erfunden.
