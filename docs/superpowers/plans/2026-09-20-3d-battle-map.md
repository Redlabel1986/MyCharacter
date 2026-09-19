# 3D-Battle-Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Battle-Map bekommt einen umschaltbaren 3D-Modus, in dem die Karte als Spielbrett im Raum liegt, Tokens als Pappaufsteller darauf stehen und der Nebel des Krieges eine begehbare Nebelbank ist.

**Architecture:** Eine Three.js-Szene lebt als austauschbarer Renderer neben der bestehenden 2D-Bühne. Die Seite bleibt Herr über Daten, Realtime und Modals; die 3D-Komponente bekommt alles als Props und meldet Kartenpixel zurück. Die reine Mathematik liegt in `shared/battle-3d.ts` (kennt weder Vue noch Three.js), die Szene in einer Factory ohne Vue-Reaktivität.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript (strict), `three` (neu, lazy geladen), vitest (Node-Umgebung, nur `test/**`).

**Spec:** `docs/superpowers/specs/2026-09-20-3d-battle-map-design.md`

## Global Constraints

- **Sichtgrenze:** Ein Spieler darf in 3D nie mehr sehen als in 2D. Sichtpolygone, Memory- und Blackout-Zellen kommen ausschließlich aus `useBattleFog`; die 3D-Bühne berechnet keine eigene Sicht.
- **Keine Vue-Reaktivität im Renderloop.** `useBattle3DScene.ts` importiert nichts aus `vue`.
- **`three` nur per `await import('three')`**, niemals als statischer Import in einer Seite oder Komponente, die im 2D-Modus lädt.
- **Keine `three/examples`-Pakete.** Kamerasteuerung wird selbst geschrieben.
- **TypeScript strict.** Kein `any`, kein `@ts-ignore` ohne begründenden Kommentar.
- **Tests laufen in Node ohne DOM.** Alles unter `shared/` muss ohne `window`, `document` und `canvas` testbar sein.
- **Kommentarsprache Deutsch**, wie im restlichen Projekt; Umlaute in Quelltext-Kommentaren als `ae/oe/ue` (bestehende Konvention).
- **Commits ohne Co-Authored-By-Zeile** (Repo-Konvention).
- Welt-Einheit = **eine Rasterzelle**. Die Karte liegt in der XZ-Ebene, zentriert im Ursprung, Bodenhöhe `y = 0`.

---

## File Structure

| Datei | Verantwortung |
|-------|---------------|
| `shared/battle-3d.ts` | Reine Mathematik: Koordinaten, Kameraklemmung, Figurenmaße, Nebelgitter. Kein Vue, kein Three.js |
| `test/battle-3d.test.ts` | Tests dazu |
| `app/composables/useTokenDrag.ts` | Zieh-Regeln für beide Bühnen: Klemmung, Rasterfang, Speichern |
| `app/composables/useBattle3DScene.ts` | Three.js-Szene als Factory. Kein Vue |
| `app/components/battle/BattleStage3D.vue` | Canvas, Props → Szene, Zeiger → Emits, DOM-Overlay |
| `app/pages/groups/[id]/battle/[mapId].vue` | Umschalter, `v-if`/`v-else` um die Bühne, Handler an `useTokenDrag` |

`useBattle3DScene.ts` wird die größte neue Datei. Wächst sie über etwa 700 Zeilen, wird der Nebel-Teil (Shader + Maskentextur) nach `app/composables/useBattle3DFog.ts` ausgelagert — in Task 7 ist das eingeplant.

---

### Task 1: Reine 3D-Mathematik

**Files:**
- Create: `shared/battle-3d.ts`
- Test: `test/battle-3d.test.ts`

**Interfaces:**
- Consumes: `Point` aus `shared/battle-geometry.ts`
- Produces:
  - `interface MapDims { imgW: number; imgH: number; gridSize: number }`
  - `interface World3 { x: number; y: number; z: number }`
  - `mapToWorld(x: number, y: number, d: MapDims): World3`
  - `worldToMap(wx: number, wz: number, d: MapDims): Point`
  - `interface CameraState { yaw: number; pitch: number; dist: number; targetX: number; targetZ: number }`
  - `clampCamera(c: CameraState, d: MapDims): CameraState`
  - `interface FigureDims { baseRadius: number; baseHeight: number; panelWidth: number; panelHeight: number; tabHeight: number }`
  - `figureDims(sizeMultiplier: number): FigureDims`
  - `interface FogGrid { cols: number; rows: number; data: Float32Array }`
  - `createFogGrid(cols: number, rows: number, fill: number): FogGrid`
  - `setFogCell(g: FogGrid, col: number, row: number, value: number): void`
  - `getFogCell(g: FogGrid, col: number, row: number): number`
  - `smoothFogGrid(g: FogGrid, radius: number): FogGrid`
  - `fogGridToRGBA(g: FogGrid): Uint8ClampedArray`
  - Konstanten `MIN_PITCH`, `MAX_PITCH`, `MIN_DIST`

- [ ] **Step 1: Write the failing test**

`test/battle-3d.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  mapToWorld,
  worldToMap,
  clampCamera,
  figureDims,
  createFogGrid,
  setFogCell,
  getFogCell,
  smoothFogGrid,
  fogGridToRGBA,
  MIN_PITCH,
  MAX_PITCH,
  MIN_DIST,
  type MapDims,
} from '../shared/battle-3d'

const dims: MapDims = { imgW: 1000, imgH: 800, gridSize: 50 }

describe('mapToWorld / worldToMap', () => {
  it('bildet die Kartenmitte auf den Ursprung ab', () => {
    const w = mapToWorld(500, 400, dims)
    expect(w.x).toBeCloseTo(0)
    expect(w.z).toBeCloseTo(0)
    expect(w.y).toBe(0)
  })

  it('misst in Rasterzellen: eine Zelle nach rechts ist eine Welt-Einheit', () => {
    const a = mapToWorld(500, 400, dims)
    const b = mapToWorld(550, 400, dims)
    expect(b.x - a.x).toBeCloseTo(1)
  })

  it('ist umkehrbar', () => {
    for (const [x, y] of [[0, 0], [137, 42], [999, 799], [500, 400]]) {
      const w = mapToWorld(x!, y!, dims)
      const back = worldToMap(w.x, w.z, dims)
      expect(back.x).toBeCloseTo(x!)
      expect(back.y).toBeCloseTo(y!)
    }
  })

  it('liefert bei gridSize 0 keine NaN', () => {
    const w = mapToWorld(10, 10, { imgW: 100, imgH: 100, gridSize: 0 })
    expect(Number.isFinite(w.x)).toBe(true)
    expect(Number.isFinite(w.z)).toBe(true)
  })
})

describe('clampCamera', () => {
  const base = { yaw: 0, pitch: 0.8, dist: 20, targetX: 0, targetZ: 0 }

  it('haelt die Neigung zwischen MIN_PITCH und MAX_PITCH', () => {
    expect(clampCamera({ ...base, pitch: -5 }, dims).pitch).toBeCloseTo(MIN_PITCH)
    expect(clampCamera({ ...base, pitch: 99 }, dims).pitch).toBeCloseTo(MAX_PITCH)
  })

  it('erlaubt flache Blickwinkel, aber nie unter den Boden', () => {
    expect(MIN_PITCH).toBeGreaterThan(0)
    expect(MAX_PITCH).toBeLessThan(Math.PI / 2)
  })

  it('haelt den Abstand ueber MIN_DIST und im Verhaeltnis zur Kartengroesse', () => {
    expect(clampCamera({ ...base, dist: 0 }, dims).dist).toBeCloseTo(MIN_DIST)
    const far = clampCamera({ ...base, dist: 100000 }, dims)
    expect(far.dist).toBeLessThan(1000)
  })

  it('haelt den Blickpunkt in der Naehe der Karte', () => {
    const r = clampCamera({ ...base, targetX: 9999, targetZ: -9999 }, dims)
    // Karte ist 20x16 Zellen, also -10..10 / -8..8 plus 25% Rand
    expect(r.targetX).toBeLessThanOrEqual(12.5)
    expect(r.targetZ).toBeGreaterThanOrEqual(-10)
  })

  it('laesst den Gierwinkel frei drehen', () => {
    expect(clampCamera({ ...base, yaw: 42 }, dims).yaw).toBeCloseTo(42)
  })
})

describe('figureDims', () => {
  it('skaliert Sockel und Tafel mit dem Groessenmultiplikator', () => {
    const one = figureDims(1)
    const three = figureDims(3)
    expect(three.baseRadius).toBeCloseTo(one.baseRadius * 3)
    expect(three.panelHeight).toBeCloseTo(one.panelHeight * 3)
  })

  it('haelt die Sockelhoehe konstant, damit kleine Figuren nicht versinken', () => {
    expect(figureDims(0.5).baseHeight).toBeCloseTo(figureDims(3).baseHeight)
  })

  it('macht die Tafel hoeher als breit', () => {
    const d = figureDims(1)
    expect(d.panelHeight).toBeGreaterThan(d.panelWidth)
  })

  it('faengt unsinnige Multiplikatoren ab', () => {
    expect(figureDims(0).baseRadius).toBeGreaterThan(0)
    expect(figureDims(-2).baseRadius).toBeGreaterThan(0)
  })
})

describe('FogGrid', () => {
  it('legt ein voll vernebeltes Gitter an', () => {
    const g = createFogGrid(4, 3, 1)
    expect(g.data.length).toBe(12)
    expect(getFogCell(g, 2, 1)).toBe(1)
  })

  it('ignoriert Zellen ausserhalb des Gitters', () => {
    const g = createFogGrid(2, 2, 1)
    expect(() => setFogCell(g, 99, 99, 0)).not.toThrow()
    expect(getFogCell(g, -1, 0)).toBe(1)
  })

  it('boescht eine einzelne offene Zelle monoton nach aussen', () => {
    const g = createFogGrid(11, 11, 1)
    setFogCell(g, 5, 5, 0)
    const s = smoothFogGrid(g, 3)
    const row = [0, 1, 2, 3, 4, 5].map((d) => getFogCell(s, 5 + d, 5))
    expect(row[0]).toBeLessThan(0.2)
    for (let i = 1; i < row.length; i++) {
      expect(row[i]!).toBeGreaterThanOrEqual(row[i - 1]!)
    }
    expect(row[5]).toBeCloseTo(1, 1)
  })

  it('erzeugt keine Treppe: benachbarte Werte unterscheiden sich nur wenig', () => {
    const g = createFogGrid(21, 21, 1)
    for (let c = 8; c <= 12; c++) for (let r = 8; r <= 12; r++) setFogCell(g, c, r, 0)
    const s = smoothFogGrid(g, 4)
    let maxJump = 0
    for (let c = 0; c < 20; c++) {
      maxJump = Math.max(maxJump, Math.abs(getFogCell(s, c + 1, 10) - getFogCell(s, c, 10)))
    }
    expect(maxJump).toBeLessThan(0.4)
  })

  it('laesst geschlossene Bereiche geschlossen', () => {
    const g = createFogGrid(9, 9, 1)
    setFogCell(g, 0, 0, 0)
    const s = smoothFogGrid(g, 2)
    expect(getFogCell(s, 8, 8)).toBeCloseTo(1, 2)
  })

  it('wandelt in RGBA um: offen = schwarz, vernebelt = weiss', () => {
    const g = createFogGrid(2, 1, 1)
    setFogCell(g, 0, 0, 0)
    const rgba = fogGridToRGBA(g)
    expect(rgba.length).toBe(2 * 1 * 4)
    expect(rgba[0]).toBe(0)
    expect(rgba[3]).toBe(255)
    expect(rgba[4]).toBe(255)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- test/battle-3d.test.ts`
Expected: FAIL — `Failed to resolve import "../shared/battle-3d"`

- [ ] **Step 3: Write the implementation**

`shared/battle-3d.ts`. Kernpunkte:

- `mapToWorld`: `g = gridSize > 0 ? gridSize : 1`; `x = (mx - imgW/2) / g`, `z = (my - imgH/2) / g`, `y = 0`.
- `worldToMap`: die Umkehrung.
- `MIN_PITCH = 0.02`, `MAX_PITCH = 1.5533` (≈89°), `MIN_DIST = 2`.
- `clampCamera`: Neigung und Abstand klemmen, Abstand zusätzlich auf `max(cols, rows) * 2.5` deckeln, Blickpunkt auf die Kartenfläche plus 25 % Rand; `yaw` unverändert durchreichen.
- `figureDims(s)`: `s = Number.isFinite(s) && s > 0 ? s : 1`; `baseRadius = 0.45 * s`, `baseHeight = 0.08` (konstant), `panelWidth = 0.95 * s`, `panelHeight = 1.35 * s`, `tabHeight = 0.1 * s`.
- `smoothFogGrid`: zwei-Pass-Boxfilter (erst waagerecht, dann senkrecht) mit Radius `radius`, danach `value = clamp01(value)`. Der Boxfilter ist separabel, also O(n) statt O(n·r²) — bei 200×200 Zellen und Radius 4 läuft er in unter einer Millisekunde. **Wichtig für den Monotonie-Test:** der Filter läuft über eine Kopie, nicht in-place, sonst schmiert der erste Pass in den zweiten.
- `fogGridToRGBA`: `v = clamp01(data[i])`, `rgb = round(v * 255)`, `a = 255`.

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- test/battle-3d.test.ts`
Expected: PASS, alle Tests grün.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: keine Fehler in `shared/battle-3d.ts`.

- [ ] **Step 6: Commit**

```bash
git add shared/battle-3d.ts test/battle-3d.test.ts
git commit -m "feat(battle-3d): reine Mathematik fuer die 3D-Buehne

Koordinaten Karte<->Welt (Welt-Einheit = eine Rasterzelle), Klemmung
der Kamerabahn, Figurenmasse aus dem Groessenmultiplikator und das
Nebelgitter samt separablem Boxfilter fuer die Boeschung."
```

---

### Task 2: Zieh-Regeln in `useTokenDrag` herauslösen

**Files:**
- Create: `app/composables/useTokenDrag.ts`
- Modify: `app/pages/groups/[id]/battle/[mapId].vue` (Zeilen 505–670: `dragStarted`, `dragOffset`, `dragStartPx`, `dragStartTokenPos`, `moveRangeOverlay`, `clampToMoveRange`, `startDrag`, `onPointerMove`, `onPointerUp`)

**Interfaces:**
- Consumes: `clampToMoveRange`, `snapToGrid` aus `shared/battle-geometry.ts`; `BattleMap`, `Token` aus `shared/battle-types.ts`
- Produces:
  ```ts
  export function useTokenDrag(opts: {
    map: Ref<BattleMap | null>
    tokens: Ref<Token[]>
    isDm: Ref<boolean>
    groupId: number
    mapId: number
    onError?: (e: unknown) => void
  }): {
    draggingTokenId: Ref<number | null>
    dragStartTokenPos: Ref<{ x: number; y: number; moveRange: number } | null>
    moveRangeOverlay: ComputedRef<{ x: number; y: number; size: number } | null>
    snapPreview: ComputedRef<{ x: number; y: number } | null>
    begin(token: Token, mapX: number, mapY: number): void
    moveTo(mapX: number, mapY: number): void
    end(o?: { shiftKey?: boolean }): Promise<{ moved: boolean; tokenId: number | null }>
    cancel(): void
  }
  ```

**Wichtig:** `end` entscheidet **nicht**, was bei `moved === false` passiert. Die Seite öffnet dann weiterhin die Info-Karte. Die Composable kennt nur Bewegung.

- [ ] **Step 1: Composable schreiben**

`begin` merkt `dragOffset = { x: mapX - token.x, y: mapY - token.y }`, `dragStartTokenPos = { x: token.x, y: token.y, moveRange: token.moveRange ?? 8 }`, setzt `draggingTokenId` und `moved = false`.

`moveTo` rechnet `next = { x: mapX - dragOffset.x, y: mapY - dragOffset.y }`, klemmt bei `!isDm` über `clampToMoveRange(..., map.gridSize)`, schreibt gerundet in das Token und setzt `moved = true`.

`end` snappt bei `!shiftKey` über `snapToGrid(t.x, t.y, map.gridType, map.gridSize)`, klemmt danach erneut (sonst umgeht ein Shift-Zug das Limit), schickt das `PUT` an `/api/groups/${groupId}/maps/${mapId}/tokens/${id}` mit `{ x, y }` und liefert `{ moved, tokenId }`.

`snapPreview` liefert während des Ziehens die gesnappte Zielposition — die 3D-Bühne zeichnet dort ihren Ring, die 2D-Bühne ignoriert sie.

`cancel` setzt alles zurück, ohne zu speichern (für `pointercancel`).

- [ ] **Step 2: 2D-Seite auf die Composable umstellen**

In `[mapId].vue` die lokalen Refs und `moveRangeOverlay` durch die Composable ersetzen. `startDrag` behält die Bildschirm→Kartenpixel-Rechnung (`rect` + `zoom`) und die `findMovableTokenAt`-Logik, ruft dann `drag.begin(target, localX, localY)`. `onPointerMove` ruft `drag.moveTo(localX, localY)`. `onPointerUp` ruft `await drag.end({ shiftKey: e.shiftKey })` und öffnet bei `moved === false` wie bisher die Info-Karte.

- [ ] **Step 3: Bestehende Tests laufen lassen**

Run: `npm run test:run`
Expected: alle bisherigen Tests weiter grün (die Regeln selbst sind unverändert, nur umgezogen).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 5: Manuell prüfen**

`npm run dev`, eine Karte öffnen: Token ziehen, loslassen, Rasterfang prüfen; als Spieler die Reichweiten-Grenze prüfen; Shift-Ziehen prüfen; Klick ohne Ziehen muss weiterhin die Info-Karte öffnen.

- [ ] **Step 6: Commit**

```bash
git add app/composables/useTokenDrag.ts "app/pages/groups/[id]/battle/[mapId].vue"
git commit -m "refactor(battle): Zieh-Regeln in useTokenDrag herausloesen

Klemmung, Rasterfang und Speichern liegen jetzt an einer Stelle und
nehmen Kartenpixel entgegen. Die 2D-Buehne reicht sie wie bisher aus
rect+zoom herein, die kommende 3D-Buehne aus einem Raycast.
Verhalten unveraendert."
```

---

### Task 3 (Etappe 1): Gerüst — Szene, Umschalter, Rückfall

**Files:**
- Modify: `package.json` (`three` + `@types/three`)
- Create: `app/composables/useBattle3DScene.ts`
- Create: `app/components/battle/BattleStage3D.vue`
- Modify: `app/pages/groups/[id]/battle/[mapId].vue`

**Interfaces:**
- Produces:
  ```ts
  export function detectWebgl2(): { ok: boolean; reason: string }
  export interface Scene3DOptions {
    imgW: number; imgH: number; gridSize: number; textureUrl: string
    onFrame?: (dtMs: number) => void
  }
  export interface Scene3DHandle {
    setMapTexture(url: string): Promise<void>
    setGroundOverlay(source: HTMLCanvasElement | null): void
    resize(w: number, h: number, dpr: number): void
    camera: {
      orbit(dxPx: number, dyPx: number): void
      pan(dxPx: number, dyPx: number): void
      zoom(deltaY: number): void
      reset(): void
      setPitchDeg(deg: number): void
      setYawDeg(deg: number): void
      state(): CameraState
    }
    pickGround(clientX: number, clientY: number): Point | null
    requestRender(): void
    dispose(): void
  }
  export async function createScene(canvas: HTMLCanvasElement, opts: Scene3DOptions): Promise<Scene3DHandle>
  ```

- [ ] **Step 1: `three` installieren**

```bash
npm install three
npm install -D @types/three
```

- [ ] **Step 2: `detectWebgl2` schreiben und prüfen**

In `useBattle3DScene.ts`, ganz oben, ohne `three`-Import (die Funktion muss laufen, *bevor* das Paket geladen wird):

```ts
export function detectWebgl2(): { ok: boolean; reason: string } {
  if (typeof document === 'undefined') return { ok: false, reason: 'Kein Browser' }
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2')
    if (!gl) return { ok: false, reason: 'Dieser Browser kann kein WebGL2.' }
    return { ok: true, reason: '' }
  } catch {
    return { ok: false, reason: 'WebGL2 ist blockiert.' }
  }
}
```

- [ ] **Step 3: Szene aufbauen**

`createScene` lädt `three` per `await import('three')` und baut:

- `WebGLRenderer` mit `antialias: true`, `powerPreference: 'high-performance'`, `outputColorSpace = SRGBColorSpace`, `shadowMap.enabled = true`, `shadowMap.type = PCFSoftShadowMap`
- `PerspectiveCamera(50, w/h, 0.1, 2000)`
- Kartenebene: `PlaneGeometry(cols, rows)`, um `-Math.PI/2` auf X gedreht, `MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 })`, `receiveShadow = true`. Textur: `anisotropy = renderer.capabilities.getMaxAnisotropy()`, `colorSpace = SRGBColorSpace`
- Brettkante: `BoxGeometry(cols + 0.3, 0.15, rows + 0.3)` unter der Ebene, dunkles mattes Material
- Boden-Overlay: zweite Ebene bei `y = 0.004`, `MeshBasicMaterial({ transparent: true, depthWrite: false })`, Textur erst später gesetzt
- Vorläufige Beleuchtung: `HemisphereLight(0xdfe7ff, 0x40352a, 0.75)` + `DirectionalLight(0xfff2d8, 1.1)` bei `(6, 12, 8)`, `castShadow`, Schattenkarte 2048

Kamera: Zustand `{ yaw, pitch, dist, targetX, targetZ }`, nach jeder Änderung durch `clampCamera` geschickt, Position aus Kugelkoordinaten. `reset()` setzt `pitch = 0.79` (45°), `yaw = 0`, `dist = max(cols, rows) * 0.9`.

Renderloop: **bei Bedarf**, nicht dauerhaft. `requestRender()` setzt ein Dirty-Flag; ein `requestAnimationFrame`-Loop rendert nur bei gesetztem Flag oder solange eine Animation läuft. Bei `document.hidden` wird nicht gerendert.

`pickGround` baut einen `Raycaster` aus den Fenster-Koordinaten, schneidet mit `new Plane(new Vector3(0,1,0), 0)` und rechnet den Treffer über `worldToMap` in Kartenpixel zurück.

`dispose` gibt Geometrien, Materialien, Texturen und den Renderer-Kontext frei und stoppt den Loop. **Ohne das leckt jeder Moduswechsel eine komplette Szene.**

- [ ] **Step 4: `BattleStage3D.vue` schreiben**

Props für diese Etappe: `map`, `imgW`, `imgH`, `groupId`, `mapId`, `gridSvgUrl`. Emits: `ready`, `fallback`.

- `onMounted`: `detectWebgl2()`; bei `!ok` sofort `emit('fallback', reason)` und nichts laden. Sonst `createScene`.
- `ResizeObserver` auf den Container → `scene.resize(w, h, Math.min(devicePixelRatio, 2))`.
- Zeiger: links ziehen → `camera.orbit`, rechts ziehen → `camera.pan` (`contextmenu` unterdrücken, wenn mehr als 4 px bewegt wurden), Rad → `camera.zoom`.
- Boden-Overlay: das bestehende `buildGridSvg`-Ergebnis in ein `Image` laden, auf einen Canvas zeichnen, `setGroundOverlay(canvas)`.
- `onBeforeUnmount`: `scene.dispose()`.

- [ ] **Step 5: Umschalter in die Seite bauen**

In `[mapId].vue`:

```ts
const stage3d = ref(false)
const stage3dReason = ref('')
onMounted(() => { stage3d.value = localStorage.getItem('battlemap.stage3d') === '1' })
watch(stage3d, (v) => localStorage.setItem('battlemap.stage3d', v ? '1' : '0'))
const onStage3dFallback = (reason: string) => { stage3d.value = false; stage3dReason.value = reason }
```

Knopf in der Werkzeugleiste (Icon `i-lucide-box`), daneben bei aktivem 3D ein Neigungsregler, ein Drehknopf und „Kamera zurücksetzen". Der bestehende Bühnen-Container bekommt `v-if="!stage3d"`, die neue Komponente `v-else`. Ist `stage3dReason` gesetzt, erscheint eine Hinweiszeile.

Die Werkzeug-Knöpfe für Fog-Pinsel, Blackout, Mauern, Startbereich, Freihand, Radierer und Objekt-Editor bekommen `:disabled="stage3d"` und den Titel „Zum Bearbeiten in die 2D-Ansicht wechseln".

- [ ] **Step 6: Typecheck und Build**

Run: `npm run typecheck` — Expected: keine Fehler
Run: `npm run build` — Expected: Erfolg; `three` erscheint als eigener Chunk, nicht im Haupt-Bundle.

- [ ] **Step 7: Manuell prüfen**

`npm run dev`: Karte öffnen, auf 3D schalten. Die Karte liegt als Brett im Raum, Raster liegt darauf, Drehen/Zoomen/Verschieben funktioniert, Neigungsregler wirkt, „Zurücksetzen" wirkt. Auf 2D zurück und wieder hin — kein Fehler in der Konsole, kein Speicherzuwachs über mehrere Wechsel.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json app/composables/useBattle3DScene.ts app/components/battle/BattleStage3D.vue "app/pages/groups/[id]/battle/[mapId].vue"
git commit -m "feat(battle-3d): Geruest — Szene, Kamera, Umschalter, Rueckfall

three wird erst beim Umschalten geladen. Karte liegt als Brett mit
Kante im Raum, Raster als Boden-Overlay, freie Orbit-Kamera mit
Klemmung. Ohne WebGL2 bleibt die Ansicht 2D und sagt warum."
```

---

### Task 4 (Etappe 2): Spielfiguren

**Files:**
- Modify: `app/composables/useBattle3DScene.ts`
- Modify: `app/components/battle/BattleStage3D.vue`

**Interfaces:**
- Consumes: `figureDims`, `mapToWorld` aus Task 1
- Produces:
  ```ts
  export interface Figure3DInput {
    id: number; x: number; y: number; sizeMultiplier: number
    imageUrl: string | null; name: string
    baseColor: string            // Besitzerfarbe als CSS-Hex
    hpRatio: number | null       // 0..1, null = kein HP-Ring
    dead: boolean; hidden: boolean; wounded: number  // 0..1 Rotstich
    isTurn: boolean; isTarget: boolean
  }
  // an Scene3DHandle:
  setTokens(list: Figure3DInput[]): void
  projectToScreen(mapX: number, mapY: number, heightCells: number): { x: number; y: number; visible: boolean }
  pickToken(clientX: number, clientY: number): number | null
  ```

- [ ] **Step 1: Figurenbau**

Pro Token eine `Group` mit vier Kindern:

1. **Sockel** — `CylinderGeometry(baseRadius, baseRadius * 1.06, baseHeight, 32)`, `MeshStandardMaterial({ color: baseColor, roughness: 0.6 })`, `castShadow`, `receiveShadow`. Die leicht größere Unterseite gibt die Fase.
2. **HP-Ring** — `RingGeometry(baseRadius * 0.86, baseRadius, 48, 1, 0, hpRatio * Math.PI * 2)`, flach auf die Sockeloberkante gelegt, Farbe aus `hpRatio` interpoliert (grün `0x22c55e` → gelb `0xeab308` → rot `0xdc2626`). Bei `hpRatio === null` nicht anlegen.
3. **Steckfuß** — schmale `BoxGeometry(panelWidth * 0.28, tabHeight, 0.04)` zwischen Sockeloberkante und Tafelunterkante, dunkles Material.
4. **Tafel** — `PlaneGeometry(panelWidth, panelHeight, 8, 1)`, Scheitelpunkte in Z um `sin(u * π) * panelWidth * 0.06` nach hinten gewölbt, `MeshStandardMaterial({ map, transparent: true, alphaTest: 0.5, side: DoubleSide, roughness: 0.85 })`. Untere Kante sitzt auf `baseHeight + tabHeight`.

**Rückseite:** ein zweites, identisches Mesh direkt dahinter mit `side: BackSide` und `color: 0x6b6259` sowie derselben Textur als `map` mit `colorSpace = SRGBColorSpace` — wirkt wie bedruckte, abgegriffene Pappe. Das vordere Mesh bekommt `side: FrontSide`.

**Kontaktschatten:** eine `CircleGeometry(baseRadius * 1.5)` bei `y = 0.003` mit einer prozedural erzeugten Radialgradient-Textur (`CanvasTexture`, einmal für alle Figuren angelegt und geteilt), `MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.45 })`.

**Billboard:** im Renderloop `group.rotation.y = Math.atan2(cam.position.x - group.position.x, cam.position.z - group.position.z)`. Nur die Hochachse — die Tafel kippt nie.

**Zustände:**
- `isTurn`: Ring um den Sockel (`RingGeometry`, `MeshBasicMaterial`, Akzentfarbe), Skalierung pulsiert mit `1 + 0.09 * sin(t * 5)`; bei reduzierter Bewegung konstant
- `isTarget`: zweiter Ring in `0xdc2626`
- `dead`: `group.rotation.z = 80°`, Tafel auf den Sockel gekippt
- `hidden`: `material.opacity = 0.45`, `transparent = true`
- `wounded`: `material.color.setRGB(1, 1 - w * 0.55, 1 - w * 0.55)` auf der Tafel

**Wiederverwendung:** `setTokens` vergleicht gegen eine `Map<number, Group>`. Unveränderte Figuren werden nur verschoben, neue gebaut, verschwundene entsorgt (Geometrie + Material + Textur freigeben). Texturen kommen aus einem `Map<string, Texture>`-Cache, damit zwei Tokens mit demselben Bild eine Textur teilen.

- [ ] **Step 2: `pickToken`**

`Raycaster.intersectObjects(figureGroups, true)`, das nächste Ergebnis über `object.userData.tokenId` auflösen. Kontaktschatten und HP-Ringe bekommen `raycast = () => {}`, damit nur Sockel und Tafel treffen.

- [ ] **Step 3: DOM-Overlay für Namen, HP und Effekte**

In `BattleStage3D.vue` ein absolut positionierter Container über dem Canvas mit `pointer-events: none`. Pro sichtbarem Token ein `<div>`, dessen Position **pro Frame direkt** geschrieben wird:

```ts
const p = scene.projectToScreen(t.x, t.y, figureDims(t.sizeMultiplier).panelHeight + 0.2)
el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -100%)`
el.style.display = p.visible ? '' : 'none'
```

Nicht über Vue-Reaktivität — die Refs auf die Elemente kommen aus einem `Map<number, HTMLElement>`, gefüllt per `:ref`-Funktion. Der Inhalt (Name, HP-Zahl, `AnimatedNumber`, Effekt-Overlays) bleibt normales Vue-Template und nutzt die bestehenden CSS-Klassen aus `[mapId].vue`.

Damit die Effekt-Animationen (`fx-shake`, `fx-heal-glow`, `token-emoji-bubble` …) greifen, wandern die betreffenden Regeln aus dem `<style>`-Block von `[mapId].vue` nach `app/assets/css/main.css`, weil sie nun in zwei Komponenten gebraucht werden. Die Klassennamen bleiben gleich.

- [ ] **Step 4: Sichtbarkeit anbinden**

`BattleStage3D` bekommt `isTokenVisibleToViewer` als Prop und filtert damit die Liste, die an `setTokens` geht. **Unsichtbare Tokens werden gar nicht erst gebaut** — nicht nur ausgeblendet, damit sie auch per Raycast nicht auffindbar sind.

- [ ] **Step 5: Typecheck und manuell prüfen**

Run: `npm run typecheck`

`npm run dev`: Figuren stehen auf dem Brett, drehen sich beim Orbit mit, werfen Schatten. Von hinten ist die graue Rückseite zu sehen. HP-Ring passt zur Zahl. Ein totes Token liegt. Als Spieler sind versteckte Tokens nicht da. Namen und HP kleben korrekt über den Köpfen, auch beim Drehen.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(battle-3d): Tokens als Spielfiguren

Sockel mit HP-Ring, Steckfuss, gewoelbte Bildtafel als Billboard um
die Hochachse, abgedunkelte Pappruekseite und weicher Kontaktschatten.
Namen, HP und Treffer-Effekte liegen als DOM-Overlay ueber der
projizierten Kopfposition. Unsichtbare Tokens werden nicht gebaut."
```

---

### Task 5 (Etappe 3): Interaktion

**Files:**
- Modify: `app/components/battle/BattleStage3D.vue`
- Modify: `app/composables/useBattle3DScene.ts`
- Modify: `app/pages/groups/[id]/battle/[mapId].vue`

**Interfaces:**
- Consumes: `useTokenDrag` aus Task 2, `pickToken`/`pickGround` aus Task 3/4
- Produces: Emits `token-grab`, `token-move`, `token-drop`, `token-click`, `token-dblclick`, `token-context`, `ground-click`; an `Scene3DHandle` zusätzlich
  ```ts
  setDragState(s: {
    tokenId: number | null
    snap: { x: number; y: number } | null
    rangeBox: { x: number; y: number; size: number } | null
  }): void
  ```

- [ ] **Step 1: Zeiger-Zustandsautomat**

`pointerdown` links: `pickToken` zuerst. Trifft er ein Token, das der Nutzer bewegen darf → `emit('token-grab', { id, mapX, mapY })` und Zieh-Modus. Trifft er ein fremdes Token → Klick-Modus (Info-Karte). Trifft er den Boden → Orbit-Modus, außer `toolMode` ist `aoe` oder `ping`, dann `emit('ground-click')`.

`pointerdown` rechts: trifft er ein Token → merken; bewegt sich der Zeiger unter 4 px bis `pointerup`, `emit('token-context', { id, clientX, clientY })`, sonst Pan. Auf dem Boden immer Pan, und `contextmenu` wird unterdrückt, sobald gezogen wurde.

Doppelklick auf ein Token → `emit('token-dblclick', id)`.

Der 4-px-Schwellwert steht als Konstante `DRAG_THRESHOLD_PX = 4` an einer Stelle, damit Token-Zug und Rechtsklick dieselbe Grenze nutzen.

- [ ] **Step 2: Zieh-Rückmeldung in der Szene**

`setDragState` sorgt für drei Dinge:
- Die gezogene Figur hebt sich auf `y = 0.35` und ihr Kontaktschatten wächst auf `scale 1.35` bei `opacity 0.3`.
- Am Rasterfang-Ziel liegt ein Ring (`RingGeometry`, Akzentfarbe, `y = 0.006`).
- Bei gesetzter `rangeBox` liegt dort eine leuchtende Fläche (`PlaneGeometry`, `MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.14, depthWrite: false })`) mit einem helleren Rand aus `EdgesGeometry`.

- [ ] **Step 3: Seite verdrahten**

In `[mapId].vue` die neuen Emits an die vorhandenen Handler hängen:

```ts
const on3dGrab = (e: { id: number; mapX: number; mapY: number }) => {
  const t = tokens.find((x) => x.id === e.id)
  if (t && canMoveToken(t)) drag.begin(t, e.mapX, e.mapY)
}
const on3dMove = (e: { mapX: number; mapY: number }) => drag.moveTo(e.mapX, e.mapY)
const on3dDrop = async (e: { shiftKey: boolean }) => {
  const r = await drag.end({ shiftKey: e.shiftKey })
  if (!r.moved && r.tokenId !== null) infoTokenId.value = r.tokenId
}
```

`token-context` ruft `onTokenContext`, `token-dblclick` ruft `startEdit`, `ground-click` ruft im AoE-Modus `setAoeCenter` und sonst die bestehende Ping-Funktion — dieselben Funktionen wie in 2D, kein zweiter Pfad.

- [ ] **Step 4: Typecheck und manuell prüfen**

Run: `npm run typecheck`

`npm run dev`: Figur greifen, ziehen, loslassen — sie rastet ein und die Position bleibt nach `F5` erhalten. Als Spieler greift die Reichweitenfläche und die Grenze hält. Rechtsklick auf eine Figur öffnet das Menü, Rechts-Ziehen auf dem Boden verschiebt ohne Menü. Doppelklick öffnet den Editor. Ping und AoE landen an der angeklickten Stelle. Ein zweiter Browser zeigt die Bewegung in Echtzeit.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(battle-3d): Figuren ziehen, Kontextmenue, Ping, AoE

Raycast gegen die Bodenebene liefert Kartenpixel; Klemmung, Rasterfang
und Speichern laufen ueber dieselbe useTokenDrag-Composable wie in 2D.
Beim Ziehen hebt die Figur an, der Schatten wird weicher und das
Reichweitenfeld liegt leuchtend auf dem Boden."
```

---

### Task 6 (Etappe 4): Welt — Mauern, Objekte, Boden-Overlay

**Files:**
- Modify: `app/composables/useBattle3DScene.ts`
- Modify: `app/components/battle/BattleStage3D.vue`

**Interfaces:**
- Produces:
  ```ts
  setWalls(walls: Wall[], visible: boolean): void
  setObjects(list: Object3DInput[]): void
  export interface Object3DInput {
    id: number; x: number; y: number; w: number; h: number
    rotation: number; imageUrl: string | null; lightRadius: number
  }
  ```

- [ ] **Step 1: Mauern extrudieren**

Pro Segment ein `BoxGeometry(length, 1.1, 0.12)`, positioniert auf der Mitte des Segments, um `atan2` gedreht, `castShadow = true`, `MeshStandardMaterial({ color: 0x4a4038, roughness: 0.9 })`. `visible = isDm` — für Spieler sind die Meshes im Graphen, aber unsichtbar; sie formen trotzdem Licht und Nebel (Task 7 nutzt dafür die Maske, nicht die Geometrie). `raycast = () => {}`, damit Mauern nie ein Token-Picking abfangen.

Alle Mauern werden zu **einer** zusammengeführten Geometrie (`BufferGeometryUtils.mergeGeometries` gibt es nicht ohne `examples` — stattdessen eine `InstancedMesh` mit einer Einheits-Box und pro Mauer einer Matrix). Bei 200 Mauersegmenten ist das ein Draw Call statt 200.

- [ ] **Step 2: Objekte**

Flache Ebene bei `y = 0.005`, Größe aus `displayW`/`displayH` in Weltzellen, um `rotation` gedreht, Textur aus dem geteilten Cache. Kontaktschatten wie bei Figuren. Bei `lightRadius > 0` ein `PointLight(0xffd9a0, 1.2, lightRadius + 0.5)` bei `y = 0.6` — ohne Schatten.

- [ ] **Step 3: Boden-Overlay vervollständigen**

Ein Canvas in Kartengröße, gedeckelt auf 2048 px lange Kante. Gezeichnet wird in dieser Reihenfolge: Raster (aus `buildGridSvg`, einmal als Bild geladen), Freihandzeichnungen (`pointsToPath`-Punkte direkt als `ctx.lineTo`), Startbereich (nur DM, grün), AoE-Rechteck, Pings. Neu gezeichnet nur, wenn sich eine der Quellen ändert — ein `watch` auf `[drawings, startCells, aoeRectPx, visiblePings, gridSvgUrl]` mit `requestAnimationFrame`-Drosselung, damit ein Ping-Schwall nicht jedes Frame neu malt.

- [ ] **Step 4: Typecheck und manuell prüfen**

Run: `npm run typecheck`

`npm run dev`: Als DM stehen Mauern als Quader und werfen Schatten; als Spieler sind sie unsichtbar. Objekte liegen flach mit Schatten, Fackeln leuchten. Zeichnungen aus der 2D-Ansicht erscheinen auf dem Boden. Ein Ping ist an der richtigen Stelle.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(battle-3d): Mauern, Objekte und Boden-Overlay

Mauern als InstancedMesh-Quader (ein Draw Call, nur fuer den DM
sichtbar), Objekte flach mit Kontaktschatten und warmem Punktlicht bei
lightRadius, Raster/Zeichnungen/Startbereich/AoE/Pings in einer
gemeinsamen Canvas-Textur ueber der Karte."
```

---

### Task 7 (Etappe 5): Nebel und Licht

**Files:**
- Create: `app/composables/useBattle3DFog.ts`
- Modify: `app/composables/useBattle3DScene.ts`
- Modify: `app/components/battle/BattleStage3D.vue`
- Modify: `test/battle-3d.test.ts` (Sichtgrenzen-Test)

**Interfaces:**
- Consumes: `createFogGrid`, `setFogCell`, `smoothFogGrid`, `fogGridToRGBA` aus Task 1
- Produces:
  ```ts
  export interface FogInput {
    enabled: boolean
    cols: number; rows: number
    visibleCells: Array<[number, number]>   // volle Sicht
    memoryCells: Array<[number, number]>    // Erinnerung, halbdunkel
    blackoutCells: Array<[number, number]>  // undurchdringlich
    nightMask: boolean
    darkColor: string
  }
  setVision(input: FogInput): void
  setTimeOfDay(tod: TimeOfDay, isDm: boolean, lights: Array<{ x: number; y: number; radiusPx: number }>): void
  ```

- [ ] **Step 1: Sichtgrenzen-Test schreiben**

Ergänzung in `test/battle-3d.test.ts`:

```ts
import { buildFogGridFromCells } from '../shared/battle-3d'

describe('buildFogGridFromCells', () => {
  it('oeffnet nur Zellen, die als sichtbar uebergeben wurden', () => {
    const g = buildFogGridFromCells(5, 5, [[1, 1]], [], [])
    expect(getFogCell(g, 1, 1)).toBe(0)
    expect(getFogCell(g, 4, 4)).toBe(1)
  })

  it('haelt Erinnerungszellen halbdunkel, nicht offen', () => {
    const g = buildFogGridFromCells(5, 5, [], [[2, 2]], [])
    const v = getFogCell(g, 2, 2)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(1)
  })

  it('haelt Blackout-Zellen geschlossen, auch wenn sie sichtbar waeren', () => {
    const g = buildFogGridFromCells(5, 5, [[3, 3]], [[3, 3]], [[3, 3]])
    expect(getFogCell(g, 3, 3)).toBe(1)
  })
})
```

Run: `npm run test:run -- test/battle-3d.test.ts` → FAIL (`buildFogGridFromCells` nicht exportiert)

- [ ] **Step 2: `buildFogGridFromCells` in `shared/battle-3d.ts` ergänzen**

Reihenfolge ist die Regel: voll vernebelt füllen → Memory auf `0.55` → sichtbar auf `0` → **Blackout zuletzt auf `1`**. Blackout gewinnt immer; das ist die Regel, die den dritten Test trägt und ein Informationsleck verhindert.

Run: `npm run test:run -- test/battle-3d.test.ts` → PASS

- [ ] **Step 3: Maskentextur**

In `useBattle3DFog.ts`: `buildFogGridFromCells` → `smoothFogGrid(g, 2)` → `fogGridToRGBA` → `DataTexture(rgba, cols, rows, RGBAFormat)` mit `minFilter = LinearFilter`, `magFilter = LinearFilter`, `needsUpdate = true`. Die Textur wird bei Änderung in-place neu befüllt statt neu angelegt.

- [ ] **Step 4: Nebelbank**

`PlaneGeometry(cols, rows, cols * 2, rows * 2)`, waagerecht, `ShaderMaterial` mit `transparent: true`, `depthWrite: false`, `side: DoubleSide`.

Vertex-Shader: `float m = texture2D(uMask, uv).r;` → `pos.y += m * uHeight;` (`uHeight` ≈ 2.2 Zellen). `varying float vFog = m; varying float vHeight = pos.y;`

Fragment-Shader: Farbe aus `mix(uFogNear, uFogFar, vHeight / uHeight)`, Alpha `smoothstep(0.15, 0.75, vFog)`, darüber dreifach überlagertes Value-Rauschen (`uTime`-gedriftet, drei Oktaven mit unterschiedlicher Frequenz und Richtung), das die Alpha moduliert. Bei `prefers-reduced-motion` bleibt `uTime` stehen.

**Ein Draw Call.**

- [ ] **Step 5: Bodenschwaden**

Zweite Ebene bei `y = 0.08`, dasselbe Rauschen mit anderer Driftrichtung, Alpha `0.06 + vFog * 0.22`. Wird von der Leistungsregelung in Task 8 zuerst abgeschaltet.

- [ ] **Step 6: Licht und Bodenabdunklung**

- Das Richtungslicht bekommt Farbe, Winkel und Intensität aus `TIME_OF_DAY_OVERLAYS`. Es bleibt das einzige schattenwerfende Licht.
- Die Kartenebene bekommt die Maskentextur als zweite Textur; im `onBeforeCompile` des `MeshStandardMaterial` wird `gl_FragColor.rgb *= mix(1.0, uDarkFactor, maskValue)` angehängt. So legt sich die Sicht — inklusive des bereits enthaltenen Mauer-Clippings — multiplikativ auf den Boden und sieht aus wie harte Schlagschatten, ohne eine einzige zusätzliche Schattenkarte.
- Pro Sichtquelle ein `PointLight`, sortiert nach Abstand zur Kamera, **höchstens acht**. Weiter entfernte Quellen tragen nur über die Maske bei.

- [ ] **Step 7: Typecheck und manuell prüfen**

Run: `npm run typecheck` und `npm run test:run`

`npm run dev`: Fog of War einschalten. Die Nebelbank ragt auf, die Kante böscht weich statt zu treppen, das Innere driftet langsam. Kamera flach stellen — man sieht seitlich in die Bank hinein. Auf Nacht schalten: Tokens tragen Lichtkreise, Mauern schneiden harte Kanten hinein. Blackout-Zellen sind undurchdringlich schwarz. **Als Spieler in einem zweiten Browser: nichts ist sichtbar, was in 2D verborgen wäre.**

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(battle-3d): Nebelbank, Bodenschwaden und echtes Licht

Die Maske kommt aus denselben Sichtpolygonen wie die 2D-Ansicht;
Blackout gewinnt immer. Der Vertex-Shader hebt das Nebelgitter nach
Maskenwert an, das Fragment-Programm legt Hoehennebel und driftendes
Rauschen darueber — ein Draw Call. Mauerschatten entstehen aus der
Maske statt aus zusaetzlichen Schattenkarten."
```

---

### Task 8 (Etappe 6): Feinschliff

**Files:**
- Modify: `app/composables/useBattle3DScene.ts`
- Modify: `app/components/battle/BattleStage3D.vue`

- [ ] **Step 1: Leistungsregelung**

Gleitender Mittelwert der Frame-Zeit über drei Sekunden. Drei Stufen:

| Mittel | Maßnahme |
|--------|----------|
| < 28 ms | volle Qualität |
| ≥ 28 ms | Renderauflösung 0,75, Schattenkarte 1024, Bodenschwaden aus |
| ≥ 40 ms für 5 s | `emit('perf-warning')` → Hinweisleiste mit Knopf „Zurück zu 2D" |

Die Stufe fällt nur, sie steigt nicht automatisch wieder — sonst pendelt die Auflösung sichtbar.

- [ ] **Step 2: Verdeckungs-Abblendung**

Ein Raycast pro Frame von der Kamera zur gezogenen beziehungsweise am Zug befindlichen Figur. Alles, was davor liegt, bekommt `opacity = 0.35` und `transparent = true`; beim nächsten Frame ohne Treffer wieder zurück. Nur ein Raycast, unabhängig von der Tokenzahl.

- [ ] **Step 3: Reduzierte Bewegung**

`matchMedia('(prefers-reduced-motion: reduce)')` abfragen und auf Änderungen hören: `uTime` friert ein, der „Am Zug"-Ring pulsiert nicht, die Hebe-Animation beim Ziehen wird ein harter Sprung statt einer Interpolation.

- [ ] **Step 4: Touch-Gesten**

Ein Finger auf einer Figur zieht sie, ein Finger auf dem Boden dreht. Zwei Finger: Abstandsänderung zoomt, Mittelpunktverschiebung verschiebt. `touch-action: none` auf dem Canvas.

- [ ] **Step 5: Effekte im Overlay**

Treffer, Heilung, Zauber, Liebe und Emoji-Blasen werden im DOM-Overlay über der projizierten Kopfposition gezeigt — dieselben `tokenFx`- und `tokenEmoji`-Refs und dieselben CSS-Klassen wie in 2D, die in Task 4 nach `main.css` gewandert sind.

- [ ] **Step 6: Volle Prüfung**

Run: `npm run test:run` — alle Tests grün
Run: `npm run typecheck` — keine Fehler
Run: `npm run build` — Erfolg

Manueller Prüfpfad vollständig: Karte laden, drehen, zoomen, flach stellen, Figur ziehen, Rasterfang, Nebelkante von der Seite, Nacht, Treffer auslösen, Emoji senden, auf 2D und zurück, Seite neu laden (3D muss gemerkt sein).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(battle-3d): Leistungsregelung, Verdeckung, Touch, Effekte

Frame-Zeit ueber drei Sekunden gemittelt senkt bei Bedarf Aufloesung
und Schattenqualitaet und bietet ab 40 ms den Rueckweg nach 2D an.
Figuren, die die gezogene verdecken, blenden ab. Treffer- und
Emoji-Effekte nutzen dieselben CSS-Klassen wie die 2D-Buehne."
```

---

### Task 9: Dokumentation

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Eintrag schreiben**

Im Stil der bestehenden Einträge: was der Spieler sieht (umschaltbarer 3D-Modus, Figuren, Nebelbank), was sich nicht ändert (2D bleibt vollständig, DM-Malwerkzeuge dort), und der Hinweis auf den automatischen Rückfall ohne WebGL2.

- [ ] **Step 2: Commit und Push**

```bash
git add CHANGELOG.md
git commit -m "docs: Changelog-Eintrag 3D-Battle-Map"
git push
```

---

## Self-Review

**Spec-Abdeckung.** Jeder Abschnitt der Spec hat eine Aufgabe: Architektur → Tasks 1/3, Nahtstelle → Task 2, Datenfluss → Tasks 3–5, Eingabe → Task 5, Figuren → Task 4, Welt → Task 6, Nebel und Licht → Task 7, Leistung und Rückfall → Tasks 3 und 8, Umschalter → Task 3, Tests → Tasks 1, 2 und 7, Etappen → Tasks 3–8.

**Namenskonsistenz.** `figureDims`, `mapToWorld`, `worldToMap`, `clampCamera`, `createFogGrid`, `setFogCell`, `getFogCell`, `smoothFogGrid`, `fogGridToRGBA`, `buildFogGridFromCells` sind in Task 1 beziehungsweise Task 7 definiert und werden in Tasks 3–7 unter genau diesen Namen benutzt. `Scene3DHandle` wächst über die Tasks 3, 4, 6 und 7; jede Ergänzung ist im jeweiligen Interfaces-Block genannt.

**Offene Unschärfe, bewusst stehen gelassen.** Die konkreten Shader-Konstanten in Task 7 (`uHeight`, die Rausch-Frequenzen, die `smoothstep`-Grenzen) sind Startwerte, keine Ergebnisse. Shader-Optik entscheidet sich am Bildschirm. Wenn die Nebelbank nach Etappe 5 nicht überzeugt, ist das ein eigener Gestaltungsdurchgang und kein Fehler im Plan.
