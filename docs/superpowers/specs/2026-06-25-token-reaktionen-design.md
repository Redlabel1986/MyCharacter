# Token-Reaktionen (Emojis & Effekt-Animationen) — Design

**Datum:** 2026-06-25
**Dateien:** `app/pages/groups/[id]/battle/[mapId].vue`, `app/composables/usePusher.ts`,
`server/utils/pusher.ts`, `server/api/groups/[id]/maps/[mapId]/fx.post.ts` (neu),
`app/assets/css/main.css`

## Ziel

Spieler können auf der Battle-Map kurzlebige, rein kosmetische Reaktionen auf
Tokens auslösen — live für alle sichtbar:

- **Emoji** über einem Token, verschwindet nach **10 Sekunden**.
- **Effekt-Animationen** auf einem (beliebigen) Token: **Slice** (Schaden),
  **Heilung**, **Zauber**, **Love**.

Reaktionen ändern **keine** Spielwerte (kein HP-Effekt). Jedes Gruppenmitglied
darf reagieren, auf jedes Token.

## Auslösen — Strg+Rechtsklick

`Ctrl`+Rechtsklick (`@contextmenu` mit `ctrlKey`/`metaKey`) auf ein Token öffnet
ein kleines Popover-Menü an der Cursorposition:

- Eine Reihe kuratierter Emojis (~12): 👍 ❤️ 😂 😮 😱 😡 ⚔️ 🛡️ 🎲 💀 🤔 🎉
- Vier Effekt-Buttons: Slice · Heilung · Zauber · Love

Klick auf einen Eintrag löst die Reaktion aus und schließt das Menü. Das Menü
schließt auch bei Klick daneben / `Esc`.

Kollidiert nicht mit bestehenden Gesten:
- Rechtsklick (ohne Strg) = Kampf-Ziel (`setCombatTarget`)
- Alt+Klick = Ping

In `setCombatTarget` bzw. dem `@contextmenu`-Handler wird daher zuerst auf
`ctrlKey || metaKey` geprüft: wenn gesetzt → Reaktionsmenü, sonst Kampf-Ziel.

## Übertragung — transient über Pusher (keine DB)

Neuer Endpoint `POST /api/groups/:id/maps/:mapId/fx`:

- Body (zod): `{ tokenId: number, kind: 'emoji'|'slice'|'heal'|'spell'|'love',
  emoji?: string (max 16), fxId: string (max 64) }`
- Prüft: eingeloggt, Gruppenmitglied (`requireGroupMember`), Map gehört zur
  Gruppe, Token gehört zur Map.
- Broadcastet via neuem `pushMapFx(mapId, payload)` das Pusher-Event `'fx'` auf
  `private-map-<mapId>` mit Payload `{ tokenId, kind, emoji, fxId }`.
- **Kein** DB-Schreibzugriff, **kein** Map-Refetch.
- Antwort: `{ ok: true }`.

`server/utils/pusher.ts` bekommt:

```ts
export function pushMapFx(mapId: number, payload: {
  tokenId: number; kind: string; emoji?: string; fxId: string
}) {
  return safeTrigger(`private-map-${mapId}`, 'fx', payload)
}
```

`safeTrigger` ist No-Op ohne Pusher-Config → der Endpoint bleibt fehlerfrei,
es passiert für andere dann nur nichts (rein kosmetisch, akzeptabel).

## Empfang & Abspielen

`usePusher.ts`: `subscribeMap` / `subscribeChanged` werden um einen optionalen
zweiten Handler erweitert, der zusätzlich das Event `'fx'` bindet (und beim
`unsubscribe` wieder löst). Bestehende Aufrufer ohne fx-Handler bleiben
unverändert.

Im `[mapId].vue` wird beim Map-Subscribe ein `onFx(payload)` mitgegeben:

- **slice** → bestehendes `tokenFx[tokenId] = { kind: 'damage' }` (Shake +
  Slice-Overlay, existiert bereits).
- **heal** → bestehendes `tokenFx[tokenId] = { kind: 'heal' }` (Heil-Glow,
  existiert bereits).
- **spell** / **love** → `tokenFx` wird um diese Arten erweitert; zwei neue
  CSS-Animationen + Overlay-Symbol (Funken bzw. aufsteigende Herzchen).
- **emoji** → neuer reaktiver State `tokenEmoji[tokenId] = { emoji, nonce }`:
  Emoji-Bubble über dem Token mit Pop-in, Auto-Clear nach 10s (nonce-basiert
  wie `spawnHpFx`, damit Folge-Emojis die Animation sauber neu starten).

### Sender sieht es sofort (Dedup per fxId)

Beim Auslösen generiert der Client eine `fxId` (z.B. aus `fxSeq` + User-Kennung,
da `Math.random`/`Date.now` im Workflow-Kontext tabu sind — im Browser sind sie
erlaubt, daher hier z.B. `crypto.randomUUID()`), spielt den Effekt **sofort
lokal** ab und merkt sich die `fxId` in einem kurzlebigen Set. Server-getriggerte
Pusher-Events kommen auch beim Sender an — trifft das Echo mit eigener `fxId`
ein, wird es ignoriert (kein Doppel-Abspielen). So erscheint die Reaktion auch
dann, wenn Pusher beim Sender nicht verbunden ist.

## Rendering

Im Token-Wrapper (`[mapId].vue`, Token-`v-for`):

- Vorhandene Klassen-Bindung (`fx-shake` / `fx-heal-glow`) wird um
  `fx-spell` / `fx-love` ergänzt.
- Neue Overlay-Elemente für Zauber (Funken) und Love (Herzchen), analog zu den
  bestehenden Slice/Heal-Overlays, `pointer-events-none`.
- Neues Emoji-Bubble-Element oberhalb des Tokens, sichtbar wenn
  `tokenEmoji[t.id]` gesetzt ist.

CSS in `main.css`: `@keyframes` + Klassen für `fx-spell`, `fx-love`, die
Emoji-Bubble (Pop-in + Fade-out über 10s) und die neuen Overlay-Symbole.
`prefers-reduced-motion` respektieren (Animationen aus, Symbol/Emoji bleibt kurz
statisch sichtbar).

## Edge Cases

- Token vor Eintreffen des Events gelöscht → Render nur wenn Token existiert;
  fx auf unbekanntes Token wird ignoriert.
- Leichtes Client-Throttle gegen Spam: max. eine ausgelöste Reaktion alle
  ~300 ms pro Sender.
- Ungültiger/zu langer Emoji-String → serverseitig per zod begrenzt.

## Akzeptanzkriterien

1. Strg+Rechtsklick auf ein Token öffnet das Reaktionsmenü; normaler Rechtsklick
   setzt weiterhin das Kampf-Ziel.
2. Emoji erscheint über dem Ziel-Token bei allen verbundenen Clients und
   verschwindet nach 10 s.
3. Slice/Heilung/Zauber/Love spielen die jeweilige Animation auf dem Ziel-Token
   bei allen Clients ab.
4. Der Auslöser sieht seine Reaktion sofort, ohne Doppel-Abspielen.
5. Keine HP-/Spielwert-Änderung durch Reaktionen.
6. Ohne Pusher-Verbindung wirft nichts einen Fehler (Sender sieht es lokal,
   andere sehen nichts).
