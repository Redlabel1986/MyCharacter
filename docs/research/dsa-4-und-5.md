# DSA 4.1 und DSA 5 — Charakterbogen + Berechnungen

## DSA 4.1

### Charakterbogen-Felder

**Stammdaten:** Name, Spieler, Rasse, Kultur, Profession, Geschlecht, Alter, Geburtstag, Größe, Gewicht, Augen-/Haarfarbe, Sozialstatus, Titel, Göttliche Gabe, AP gesamt/eingesetzt/frei, Erfahrungsgrad.

**Eigenschaften (8):** MU, KL, IN, CH, FF, GE, KO, KK. Plus SO (Sozialstatus). Schlechte Eigenschaften: Aberglaube, Höhenangst, Jähzorn, Goldgier, Neugier, Raumangst, Schlechte Eigenschaft, Totenangst.

**Abgeleitete Werte:**
- LeP, AuP, AsP (mag.), KaP (Geweihte), MR
- INI-Basis, AT-Basis, PA-Basis, FK-Basis
- Wundschwellen pro Trefferzone, GS, Schicksalspunkte

**Kampfwerte:** Pro Waffe: Talent, KaW, AT, PA, TP, RW, DK, Belastung. Rüstung RS pro Trefferzone, BE.

**Talente (Gruppen):** Kampf, Körperlich, Gesellschaftlich, Natur, Wissen, Sprachen/Schriften, Handwerk, Gabentalente. Pro Talent: Probe (3 Eigenschaften), TaW, Spezialisierungen, BE-Abzug, Steigerungs-Spalte (A–H).

**Zauber:** Probe, ZfW, Komplexität/Spalte, Repräsentation, Merkmale, AsP-Kosten, Reichweite, Wirkungsdauer, Zauberdauer.

**Liturgien:** LkW, Probe MU/IN/CH, KaP-Kosten, Grad.

### Berechnungsformeln DSA 4.1

```
LeP-Basis  = (KO + KO + KK) / 2 + Mod
AuP-Basis  = (MU + KO + GE) / 2 + Mod
AsP-Basis  = (MU + IN + CH) / 2 + Mod   (Vollzauberer)
KaP-Basis  = (MU + IN + CH) / 2 + Mod   (Geweihte)
MR-Basis   = (MU + KL + KO) / 5 + Mod
INI-Basis  = (MU + MU + IN + GE) / 5 + Mod
AT-Basis   = (MU + GE + KK) / 5
PA-Basis   = (IN + GE + KK) / 5
FK-Basis   = (IN + FF + KK) / 5
GS         = 8 (Standard)
```

**3W20-Probe (4.1):** 3W20, je Würfel gegen eine Eigenschaft. Modifikator wird auf TaW angewendet.
```
für i in 1..3: überhang_i = max(0, wurf_i - eigenschaft_i)
TaP* = (TaW - Modifikator) - sum(überhänge)
Probe gelingt, wenn TaP* >= 0
```

**Steigerungs-Spalten (SKT):** A=1, B=2, C=3, D=4, E=5, F=7.5, G=10, H=20. AP-Kosten = Spaltenfaktor * Tabellenwert(aktueller Wert).

### Quellen DSA 4.1
- [Wiki Aventurica – 3W20-Probe](https://de.wiki-aventurica.de/wiki/Die_3W20-Probe)
- [SKT](https://de.wiki-aventurica.de/wiki/Steigerungskosten-Tabelle)
- [DSA 4.1 Heldendokument (MIT)](https://github.com/flyx/DSA-4.1-Heldendokument)

---

## DSA 5

### Charakterbogen-Felder

**Stammdaten:** Name, Spezies, Kultur, Profession, Geschlecht, Alter, Größe, Gewicht, Augen-/Haarfarbe, Sozialstatus, AP gesamt/eingesetzt/frei, Erfahrungsgrad.

**Eigenschaften (8):** MU, KL, IN, CH, FF, GE, KO, KK. Generierung typ. 8–14, max abhängig vom Erfahrungsgrad.

**Abgeleitete Werte:**
- LeP, AsP, KaP
- **SK (Seelenkraft), ZK (Zähigkeit)** — neu in DSA 5
- INI, **AW (Ausweichen)**
- GS (Standard 8), Schicksalspunkte (Start: 3)
- Wundschwellen

**Fertigkeiten (59):** Körper(12), Gesellschaft(8), Natur(6), Wissen(15), Handwerk(12). Plus Kampftechniken (~10 Kategorien), Sprachen, Schriften, Gaben.
Pro Fertigkeit: 3 Probe-Eigenschaften, FW, Steigerungsspalte (A–D). Max FW = höchste der drei Probe-Eigenschaften + 2.

**Zauber/Liturgien:** ZfW/LkW, Probe (3 Eig.), AsP/KaP-Kosten, Reichweite, Zauberdauer, Wirkung, Wirkungsdauer, Merkmale, Repräsentation, Tradition.

### Berechnungsformeln DSA 5

```
LeP-Basis  = LE-GW(Spezies) + KO + KO + Mod
AsP-Basis  = AE-GW(Tradition) + 3 * Leiteigenschaft
KaP-Basis  = KE-GW(Tradition) + 3 * Leiteigenschaft
SK         = SK-GW(Spezies) + (MU + KL + IN) / 6
ZK         = ZK-GW(Spezies) + (KO + KO + KK) / 6
INI        = (MU + GE) / 2 + Mod
AW         = GE / 2
GS         = 8 (Spezies-abhängig: Zwerge 6, Elfen 8, …)
Schicksalspunkte = 3 (Start) + Mod
Wundschwelle = KO / 2 (kfm. gerundet)
```

**3W20-Probe (DSA 5):** 3W20, je Würfel gegen eine der drei Probe-Eigenschaften. Modifikator wird auf JEDE Eigenschaft angewendet.
```
für i in 1..3:
  effEig_i = Eigenschaft_i + Erleichterung - Erschwernis
  überhang_i = max(0, wurf_i - effEig_i)
verbleibendeFP = FW - sum(überhänge)
Probe gelingt, wenn verbleibendeFP >= 0
QS-Tabelle: 1-3→1, 4-6→2, 7-9→3, 10-12→4, 13-15→5, 16+→6
```

**Erfahrungsgrade DSA 5:**
- Unerfahren 900 AP (max Eig 13, FW 12)
- Durchschnittlich 1000 AP
- Erfahren 1100 AP (Standard, Eig 14, FW 14)
- Kompetent 1200 AP (FW 16)
- Meisterlich 1400 AP (Eig 15, FW 18)
- Brilliant 1700 AP (Eig 16, FW 19)
- Legendär 2100 AP (Eig 17, FW 20)

**Steigerungs-Spalten DSA 5:** A=1, B=2, C=3, D=4, E=15 (Eigenschaften). Stufen 0–12 konstant Faktor; ab 13: (Stufe-11) * Faktor.

### Quellen DSA 5
- [Ulisses Regel-Wiki – Proben](https://dsa.ulisses-regelwiki.de/GR_Proben.html)
- [Ulisses Regel-Wiki – Erfahrung](https://dsa.ulisses-regelwiki.de/Erfahrung.html)
- [Wiki Aventurica – Seelenkraft](https://de.wiki-aventurica.de/wiki/Seelenkraft)
- [Wiki Aventurica – Zähigkeit](https://de.wiki-aventurica.de/wiki/Z%C3%A4higkeit)
- [Optolith Charaktergenerator](https://optolith.app/de/) + [GitHub](https://github.com/elyukai/optolith-client)
- [DSA5-Konvertierungshilfe (Ulisses, frei)](https://ulisses-spiele.de/assets/document/44/DSA5-Konvertierungshilfe_0c831_1246.pdf)

---

## Implementierungs-Strategie

1. **Engine-Trennung:** Strategy-Pattern pro Edition (`engines/dsa41.ts`, `engines/dsa5.ts`) mit gleicher Schnittstelle: `computeDerived`, `rollProbe`, `costForIncrease`.
2. **Probenmechanik:** Hauptdifferenz ist Modifikator-Anwendung (4.1: auf TaW; 5: auf Eigenschaften) und QS-Berechnung (nur 5).
3. **Daten-Import statt Hartkodierung:** Talent-/Zauber-/Liturgie-Listen aus User-Upload (JSON/Optolith-Export) oder vom User editierbar.
4. **Optolith JSON-Schema** als Import-Format für DSA 5 unterstützen.

**Rechtlicher Hinweis:** Berechnungs-Formeln sind nicht schutzfähig. Talent-/Zauber-/Liturgie-Listen, Texte, Beschreibungen sind urheberrechtlich geschützt (Ulisses) — nicht in Repo committen, nur User-Input.
