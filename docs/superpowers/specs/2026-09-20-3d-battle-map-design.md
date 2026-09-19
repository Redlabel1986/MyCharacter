# 3D-Battle-Map — Design

**Datum:** 2026-09-20

**Neue Dateien:**
`shared/battle-3d.ts`,
`app/composables/useBattle3DScene.ts`,
`app/composables/useTokenDrag.ts`,
`app/components/battle/BattleStage3D.vue`,
`test/battle-3d.test.ts`

**Geänderte Dateien:**
`app/pages/groups/[id]/battle/[mapId].vue`,
`package.json` (Abhängigkeit `three`)

## Ziel

Die Battle-Map bekommt einen echten 3D-Modus: die Karte liegt als Spielbrett im
Raum, die Tokens stehen als Spielfiguren darauf, und der Nebel des Krieges ist
eine Nebelbank mit Höhe statt einer dunklen Fläche. Der Spieler soll das Gefühl
haben, auf einen gedeckten Spieltisch zu schauen, nicht auf einen Grundriss.

Die bestehende 2D-Ansicht bleibt vollständig erhalten und ist der verlässliche
Boden: sie trägt weiterhin alle DM-Malwerkzeuge und springt ein, wenn 3D nicht
läuft.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Renderer | Echtes WebGL über `three`, kein CSS-3D |
| Umfang in 3D | Spiel-Interaktionen (Figuren bewegen, Klick, Kontextmenü, Ping, AoE, Kamera). DM-Malwerkzeuge bleiben 2D |
| Figuren-Look | Pappaufsteller: Sockel + aufrechte Bildtafel |
| Nebel | Aufragende Nebelbank + Bodenschwaden + echte Lichtquellen |
| Kamera | Volle Orbit-Freiheit inklusive flacher Blickwinkel |
| Einführung | Umschalter, pro Nutzer in `localStorage` gemerkt, 2D als automatischer Fallback |
| Anbindung | Geschwister-Komponente innerhalb der bestehenden Seite |

Bewusst **nicht** Teil dieses Designs: Höhenrelief aus dem Kartenbild,
3D-Modelle statt Bildtafeln, eine eigene Sichtberechnung für 3D, animierte
Laufwege zwischen Feldern, 3D-Würfel.

## Architektur

Vier Bausteine, deren Grenzen so gezogen sind, dass die Three.js-Welt nichts von
Vue weiß und die Vue-Welt nichts von Three.js.

| Baustein | Aufgabe | Kennt nicht |
|---|---|---|
| `shared/battle-3d.ts` | Reine Mathematik: Kartenpixel ↔ Weltkoordinaten, Distanzfeld für die Nebelhöhe, Sockel- und Tafelmaße aus `sizeMultiplier`, Klemmung der Kamerabahn, Aufbau der Nebel-Maskendaten | Vue **und** Three.js |
| `app/composables/useBattle3DScene.ts` | Die Szene als Factory `createScene(canvas, opts)`. Liefert `setMap`, `setTokens`, `setObjects`, `setWalls`, `setVision`, `setTimeOfDay`, `setGroundOverlay`, `pickToken`, `pickGround`, `setCamera`, `dispose`. Eigener Renderloop | Vue |
| `app/components/battle/BattleStage3D.vue` | Canvas, Größenbeobachter, Props → `set*`-Aufrufe, Zeiger-Ereignisse → Emits, DOM-Overlay für Namen, HP und Effekte, Lade- und Fehlerzustand | — |
| `app/composables/useTokenDrag.ts` | Die Zieh-Regeln (Bewegungsreichweite klemmen, Rasterfang, Speichern) als ein Stück, von 2D und 3D gemeinsam genutzt | Three.js |

`useBattle3DScene` hält bewusst keine Vue-Reaktivität. Ein Renderloop mit 60 Hz,
der bei jedem Frame durch reaktive Proxys greift, erzeugt Tausende überflüssiger
Abhängigkeits-Abfragen pro Sekunde. Die Komponente schiebt stattdessen bei jeder
Datenänderung ein flaches Paket hinein; dazwischen rendert die Szene autark.

`three` wird per `await import('three')` erst beim ersten Umschalten geladen.
Nutzer, die in 2D bleiben, laden kein Byte davon. Die Kamerasteuerung wird
selbst geschrieben (rund 80 Zeilen) statt `OrbitControls` einzubinden, weil sie
die Sonderregeln der Bühne kennen muss — Rechts-Drag verschiebt die Karte,
außer er beginnt auf einer Figur.

## Die Nahtstelle zwischen 2D und 3D

Heute vermischen `startDrag` und `onPointerMove` in der Battle-Seite zwei Dinge:
die Umrechnung Bildschirm → Kartenpixel und die Spielregeln der Bewegung. Nur
das Erste unterscheidet sich zwischen den Bühnen.

```
2D-Bühne:  clientX/Y ──(rect + zoom)──┐
                                      ├─→ useTokenDrag.moveTo(mapX, mapY)
3D-Bühne:  clientX/Y ──(Raycast)──────┘        └─ clampToMoveRange → snap → PUT
```

`useTokenDrag` bekommt drei Funktionen: `begin(token)`, `moveTo(mapX, mapY)`,
`end({ shiftKey })`. Die Reichweiten-Klemmung, der Rasterfang und das
persistierende `PUT` liegen danach an genau einer Stelle.

Was **nicht** in die Composable wandert: die Entscheidung, ob ein Zeiger-Ende
ein Zug oder ein Klick war. `end` liefert `{ moved: boolean }` zurück; was bei
`moved === false` geschieht — heute das Öffnen der Info-Karte — bleibt Sache der
Seite, weil beide Bühnen dort dieselbe Reaktion zeigen sollen, sie aber nichts
mit Bewegung zu tun hat.

Dieses Herauslösen ist Voraussetzung, keine Kür: ohne es gäbe es die
Bewegungsregeln zweimal, und sie würden auseinanderlaufen. Die bestehenden Tests
für `snapToGrid` und die Reichweiten-Klemmung decken danach beide Bühnen ab.

## Datenfluss

**Props in `BattleStage3D`:** `map`, `tokens`, `objects`, `walls`,
`visionPolygons`, `fogMemoryCells`, `fogBlackoutCells`, `startCells`,
`drawings`, `visiblePings`, `timeOfDay`, `imgW`, `imgH`, `isDm`, `toolMode`,
`draggingTokenId`, `currentTurnTokenId`, `combatTargetId`, `aoeRectPx`, sowie
die beiden Funktionen `tokenImageSrc` und `isTokenVisibleToViewer`.

**Emits:** `token-grab`, `token-move` (Kartenpixel), `token-drop`,
`token-click`, `token-dblclick`, `token-context` (mit Bildschirmposition für das
Menü), `ground-click` (Kartenpixel, für Ping und AoE), `ready`, `fallback`
(mit Grund).

Realtime bleibt unberührt: Pusher schreibt wie bisher in die Refs der Seite, die
Änderung erreicht die 3D-Bühne als Prop und landet über einen `watch` in einem
`set*`-Aufruf. Die Szene selbst abonniert nichts.

`isTokenVisibleToViewer` und die Sichtpolygone werden hereingereicht, statt in
3D neu berechnet zu werden. Das ist eine Sicherheitsentscheidung: ein Spieler
darf in 3D unter keinen Umständen mehr sehen als in 2D. Dieselbe Quelle für
beide Bühnen schließt ein Informationsleck konstruktiv aus.

## Eingabe

| Geste | Wirkung |
|---|---|
| Links auf Figur, ziehen | Figur bewegen; Raycast gegen die Bodenebene liefert die Kartenpixel |
| Links auf Figur, kein Ziehen | Info-Karte |
| Doppelklick auf Figur | Bearbeiten |
| Rechts auf Figur | Kontextmenü |
| Links auf Boden, ziehen | Kamera drehen |
| Rechts auf Boden, ziehen | Karte verschieben; unter 4 px Bewegung zählt es als Rechtsklick |
| Rad | Zoom zum Cursor |
| Ein Finger | Figur ziehen, sonst drehen |
| Zwei Finger | Zoom und Verschieben |

Beim Ziehen hebt die Figur um etwa ein Drittel Zellhöhe an, ihr Schatten wird
größer und weicher, unter ihr erscheinen der Rasterfang-Ring und — für Spieler —
das Reichweitenfeld als leuchtende Bodenfläche. Das ist die räumliche
Entsprechung des heutigen `moveRangeOverlay`.

Die Malwerkzeuge (Fog-Pinsel, Blackout, Mauern, Startbereich, Freihand,
Objekt-Editor) sind im 3D-Modus deaktiviert und tragen den Hinweis „Zum
Bearbeiten in die 2D-Ansicht wechseln". Ihre Ergebnisse sind in 3D sichtbar.

Kamera-Neigung, -Drehung und „Kamera zurücksetzen" liegen zusätzlich als echte
Bedienelemente in der Werkzeugleiste, damit die Ansicht ohne Zeigegerät
bedienbar bleibt.

## Figuren

**Sockel:** Zylinder mit Radius `0.45 × gridSize × sizeMultiplier`, Höhe
`0.08 × gridSize`, obere Kante angefast. Mattes Material, eingefärbt nach
Besitzer. Der obere Rand trägt den HP-Ring (Verlauf grün nach rot aus
`hp / hpMax`) — die Information, die heute als Badge unter dem Token hängt,
sitzt am Sockel und bleibt aus jedem Winkel lesbar.

**Tafel:** leicht gewölbte Ebene mit acht Segmenten, Höhe
`1.35 × gridSize × sizeMultiplier`, Breite `0.95 ×`. Textur ist das Token-Bild
mit Alpha-Test, damit freigestellte PNGs sauber stehen. Die Tafel dreht sich nur
um die Hochachse zur Kamera — sie kippt nicht nach hinten, sie steht.

**Rückseite:** dieselbe Textur stark abgedunkelt und entsättigt. Fährt die
Kamera hinter eine Figur, sieht man eine graue Pappkarton-Rückseite statt eines
spiegelverkehrten Gesichts.

**Steckfuß:** schmale dunkle Lasche zwischen Tafelunterkante und Sockel, damit
die Tafel nicht schwebt.

**Schatten:** echter Schattenwurf des einen Richtungslichts, dazu ein weicher
Kontaktschatten als Radialgradient direkt unter dem Sockel. Der Kontaktschatten
ist das, was eine Figur wirklich aufgestellt aussehen lässt.

**Zustände:**

- Am Zug: pulsierender Leuchtring am Sockel (ersetzt `token-turn-ring`)
- Kampfziel: roter Ring am Sockel
- Tot (`hp <= 0`): Figur kippt um 80 Grad zur Seite und liegt auf dem Sockel
- Versteckt: halbtransparent mit Rauschmuster, nur für den DM
- Verwundet: Rotstich auf der Tafel, analog `tokenDamageBackground`

**Namen, HP-Zahlen und Effekte** (Treffer, Heilung, Zauber, Emoji) bleiben ein
DOM-Overlay über der projizierten Kopfposition. Die bestehenden CSS-Animationen
werden wiederverwendet statt in 3D nachgebaut. Die Positionen werden pro Frame
direkt per `style.transform` geschrieben, nicht über Vue-Reaktivität.

## Welt

**Kartenebene:** texturierte Ebene mit anisotroper Filterung auf dem
Hardware-Maximum. Das ist die Gegenmaßnahme zum flachen Blickwinkel, den die
freie Kamera erlaubt.

**Brettkante:** die Karte bekommt eine Extrusion von etwa 0,15 Zellen und
darunter eine dunkle Fläche. Sie wirkt dann wie ein aufgelegtes Spielbrett statt
wie eine schwebende Tapete.

**Mauern:** jedes Segment aus `map.walls` wird zu einem Quader, Höhe rund 1,1
Zellen, Dicke 0,12. Nur für den DM sichtbar, wie heute. Für Spieler bleiben sie
unsichtbare Geometrie, die Nebel und Licht formt.

**Objekte:** liegen flach auf dem Boden als texturierte Ebenen, bekommen
Kontaktschatten und, bei `lightRadius > 0`, eine warme Lichtquelle.

**Boden-Overlay:** Raster, Freihandzeichnungen, Startbereich, AoE-Feld und Pings
werden in eine einzige Canvas-Textur gemalt und als zweite Ebene knapp über der
Karte gelegt. Neu gezeichnet wird nur bei Änderung.

## Nebel und Licht

**Maskentextur.** Aus denselben `visionPolygons`, Memory-Zellen und
Blackout-Zellen, die heute die SVG-Masken speisen, entsteht ein Graustufen-Canvas
mit einem Pixel je Rasterzelle, anschließend weichgezeichnet. Gleiche Quelle wie
2D, deshalb garantiert gleiche Sichtgrenze.

**Nebelbank.** Ein dichtes Gitter über der Karte, dessen Scheitelpunkte im
Vertex-Shader nach oben verschoben werden. Die Höhe folgt dem Maskenwert, über
ein Distanzfeld geglättet, damit die Kante böscht statt zu treppen. Der
Fragment-Shader legt einen Höhennebel-Verlauf und dreifach überlagertes Rauschen
darüber, das langsam driftet. Ein einziger Draw Call.

**Bodenschwaden.** Zweite, sehr niedrige Ebene mit demselben Rauschen und
anderer Driftgeschwindigkeit: überall dünn, im Unerforschten dichter.

**Blackout-Zellen** bekommen Maskenwert 1 und schwarze statt graue Nebelfarbe.
Die Wand steht dort undurchdringlich.

**Richtungslicht.** Eines, für die Tageszeit. Farbe, Winkel und Intensität
stammen aus `TIME_OF_DAY_OVERLAYS`. Es ist das einzige schattenwerfende Licht,
Schattenkarte 2048.

**Punktlichter.** Eines je Sichtquelle, Radius aus `radiusPx`, ohne eigene
Schattenkarte. Stattdessen wird die Sichtmaske — die das Mauer-Clipping bereits
enthält — multiplikativ auf den Boden gelegt. Das sieht aus wie harte
Schlagschatten der Mauern und kostet nichts. Obergrenze acht Punktlichter, die
der Kamera am nächsten; weiter entfernte Quellen tragen nur über die Maske bei.

## Leistung und Rückfall

- WebGL2 wird vor dem Laden geprüft. Fehlt es, bleibt die Ansicht 2D und zeigt
  eine Hinweiszeile.
- `devicePixelRatio` wird auf 2 gedeckelt.
- Gleitender Mittelwert der Frame-Zeit über drei Sekunden. Über 28 ms:
  Renderauflösung auf 0,75, Schattenkarte auf 1024, Bodenschwaden aus. Bleibt er
  über 40 ms, erscheint ein Hinweis mit dem Knopf „Zurück zu 2D".
- Bei `prefers-reduced-motion` stehen Nebeldrift und Pulsieren still.
- Gerendert wird bei Bedarf statt in einer Dauerschleife; im Hintergrund-Tab
  ruht der Loop.

**Verdeckung.** Weil die Kamera bis auf einen flachen Winkel herunterdarf,
können Figuren einander verdecken. Ein Raycast pro Frame von der Kamera zur
gezogenen beziehungsweise am Zug befindlichen Figur blendet alles ab, was davor
steht, auf 35 Prozent.

## Umschalter

Ein Schalter in der Werkzeugleiste über der Bühne wechselt zwischen 2D und 3D.
Die Wahl wird pro Nutzer in `localStorage` gemerkt (Schlüssel
`battlemap.stage3d`, analog zum bestehenden `battlemap.compact`). Sie ist
nutzergebunden, nicht kartengebunden: der DM zwingt niemandem 3D auf, und jeder
am Tisch entscheidet nach seiner Hardware.

## Tests

Die reinen Module werden mit dem bestehenden vitest-Setup abgedeckt
(`test/battle-3d.test.ts`):

- Kartenpixel → Weltkoordinaten → Kartenpixel ergibt den Ausgangswert zurück
- Kameraklemmung hält Neigung und Abstand in ihren Grenzen
- Sockel- und Tafelmaße bei `sizeMultiplier` 0,5 / 1 / 3
- Distanzfeld: eine einzelne aufgedeckte Zelle ergibt eine monoton fallende
  Böschung, keine Treppe
- Maskenaufbau: Zellmengen werden korrekt zu Pixeln
- Sichtgrenze: eine Zelle, die `isTokenVisibleToViewer` für einen Spieler
  verneint, ist in der Maske nicht offen

Der Renderer selbst bekommt keine Unit-Tests. Für ihn gilt ein manueller
Prüfpfad, der vor dem Abschluss jeder Etappe durchlaufen wird: Karte laden,
drehen, zoomen, flach stellen, Figur ziehen, Rasterfang prüfen, Nebelkante von
der Seite ansehen, Nacht schalten, auf 2D zurückschalten und wieder zurück.

## Etappen

Jede Etappe ist für sich lauffähig und abschließbar.

1. **Gerüst** — Umschalter, WebGL-Erkennung, Rückfall, Kartenebene mit
   Brettkante, Kamera, Boden-Overlay-Textur für das Raster. Ergebnis: die Karte
   ist in 3D zu sehen, dreh- und zoombar.
2. **Figuren** — Sockel, Tafel, Rückseite, Steckfuß, Kontaktschatten, Namen- und
   HP-Overlay, Sichtbarkeitsregeln, Zustände.
3. **Interaktion** — `useTokenDrag` herauslösen, Raycast-Ziehen, Reichweitenfeld,
   Snap-Vorschau, Klick, Doppelklick, Kontextmenü, Ping, AoE.
4. **Welt** — Mauern extrudiert, Objekte, Zeichnungen, Startbereich und Pings im
   Boden-Overlay.
5. **Nebel und Licht** — Maskentextur, Nebelbank-Shader, Bodenschwaden,
   Tageszeitlicht, Punktlichter, Blackout.
6. **Feinschliff** — Leistungsregelung, Verdeckungs-Abblendung, reduzierte
   Bewegung, Touch-Gesten, Treffer- und Emoji-Effekte im Overlay.
