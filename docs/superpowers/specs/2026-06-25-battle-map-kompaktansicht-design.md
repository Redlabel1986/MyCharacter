# Battle-Map Kompaktansicht — Design

**Datum:** 2026-06-25
**Datei betroffen:** `app/pages/groups/[id]/battle/[mapId].vue`, `app/assets/css/main.css`

## Ziel

Eine Kompaktansicht der Battle-Map, bei der alles auf einer Ebene in einem
Bildschirm sichtbar ist — ohne Fenster rauspoppen zu müssen und ohne die ganze
Seite scrollen zu müssen:

- **Links:** Mini-Charblatt (`MiniCharSheet`)
- **Mitte:** Karte (immer im Blick, das Hauptelement)
- **Rechts:** Chat (`GroupChat`)

Sheet- und Chat-Breite sind per Drag ziehbar; die Karte in der Mitte nimmt den
restlichen Platz (`flex: 1`). Die einzelnen Spalten scrollen bei Bedarf intern,
die Seite selbst scrollt nie.

## Aktivierung

- Neuer Toolbar-Button **„Kompakt"** (Icon `i-lucide-columns-3`) neben dem
  App-Modus-Button.
- State `compact` (ref), gemerkt in `localStorage` unter
  `battlemap.compact`.
- Schließt sich mit dem App-Modus gegenseitig aus: Aktivieren des einen
  deaktiviert das andere.
- Nur ab Breakpoint `lg` aktiv/sichtbar (3 Spalten brauchen Platz). Auf
  Mobile bleibt das Layout wie heute.

## Ansatz: CSS-gesteuertes Reflow (kein DOM-Umbau)

Sheet und Karte liegen beide in der Hauptspalte (`flex-1`), der Chat ist ein
separates `<aside>`. Statt das große Template umzubauen, wird bei aktivem
Kompaktmodus die Klasse `compact-active` auf `<html>` gesetzt (analog zu
`app-mode-active`). Das Layout entsteht rein per CSS:

1. Die Hauptspalte (`flex-1`-Div) erhält `display: contents` → ihre Kinder
   (Karten-Card, Sheet-Wrapper, Audio, DM-Panels …) werden direkte Flex-Items
   des äußeren Row-Containers.
2. Der äußere Container wird `position: fixed` unter dem Header und nimmt die
   volle Viewport-Höhe ein.
3. Per CSS `order` + Sichtbarkeit werden drei Spalten gebildet:
   - Sheet-Wrapper → `order: 1` (links), feste Breite `--sheet-w`,
     `overflow-y: auto`
   - Karten-Card → `order: 2` (Mitte), `flex: 1`, volle Höhe
   - Chat-`<aside>` → `order: 3` (rechts), feste Breite `--chat-w`,
     `overflow-y: auto`
4. Alle übrigen Blöcke (Audio-Panel, DM-Steuerung, Initiative-Card,
   Hinweistext, sonstige Panels) bekommen die Klasse `compact-hide` und werden
   ausgeblendet. Sie sind weiterhin erreichbar, sobald der Kompaktmodus
   verlassen wird.

> Entscheidung: Die Initiative-Leiste wird im Kompaktmodus **ausgeblendet**
> (`compact-hide`), damit die Karte maximal sichtbar bleibt. Kann später als
> schmaler Overlay-Streifen nachgerüstet werden, falls gewünscht — bewusst
> YAGNI.

### Verworfene Alternative

Karten-Bühne in eine eigene Komponente extrahieren und ein echtes
`v-if`-3-Spalten-Layout bauen. Sauberer, aber die Bühne hängt an dutzenden
Refs/Handlern im Page-File → hohes Regressionsrisiko für rein optischen
Gewinn. Daher CSS-Reflow.

## Resize (beide Kanten)

- **Rechte Kante (Karte | Chat):** Die bestehende `chatWidth`-Drag-Logik wird
  unverändert wiederverwendet (Min/Max `CHAT_MIN`/`CHAT_MAX`, Persistenz in
  `battlemap.chatWidth`).
- **Linke Kante (Sheet | Karte):** Neu, symmetrisch aufgebaut:
  - `sheetWidth` (ref), Persistenz unter `battlemap.sheetWidth`
  - Min/Max analog zum Chat (z. B. 280–560 px)
  - Drag-Handle am rechten Rand der Sheet-Spalte; nur im Kompaktmodus sichtbar
  - Breite wird als CSS-Var `--sheet-w` auf den äußeren Container gesetzt
- Drag-Handles sind nur sichtbar/aktiv, wenn `compact-active` gilt.

## Höhen / Scroll

- Äußerer Container: `height: calc(100vh - <header>)`, `overflow: hidden`.
- Sheet- und Chat-Spalte: `height: 100%`, `overflow-y: auto` (interner Scroll).
- Karten-Card: `height: 100%`; der vorhandene `stageWrapperEl` (heute
  `max-height: 78vh`, `overflow: auto`) wird im Kompaktmodus auf
  `height: 100%` / `max-height: none` gesetzt, damit Pan/Zoom den vollen
  Mittelbereich nutzt.

## Komponenten / Props

Keine Änderungen an `MiniCharSheet` oder `GroupChat` nötig — beide werden mit
denselben Props weiterverwendet, nur ihre Container werden per CSS positioniert.

## Akzeptanzkriterien

1. Toggle „Kompakt" schaltet das 3-Spalten-Layout an/aus; State übersteht
   Reload (localStorage).
2. Sheet links, Karte mitte, Chat rechts — alle gleichzeitig auf einem Screen
   ohne Seiten-Scroll.
3. Linke und rechte Kante per Drag verstellbar; Breiten bleiben nach Reload
   erhalten.
4. Karte bleibt jederzeit vollständig sichtbar; Sheet/Chat scrollen intern.
5. App-Modus und Kompaktmodus schließen sich gegenseitig aus.
6. Unter `lg` unverändertes Verhalten; Kompakt-Button dort ausgeblendet.
