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
  buildFogGridFromCells,
  fogMaskRGBA,
  erodeOpenArea,
  light3dFor,
  cameraPosition,
  TAVERN_ROOM,
  TAVERN_CEILING_Y,
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

describe('Kamera bleibt in der Schankstube', () => {
  /**
   * Der Raum ist nur so lange glaubhaft, wie die Kamera drin bleibt. Verlaesst
   * sie ihn, blickt man von aussen durch die Waende — und das faellt erst auf,
   * wenn jemand ganz herauszoomt und steil von oben schaut.
   */
  const corners = (span: number) => ({
    half: TAVERN_ROOM.half * span,
    ceiling: TAVERN_CEILING_Y * span,
    floor: TAVERN_ROOM.floorY * span,
  })

  it('haelt jede erreichbare Kameraposition innerhalb der Waende', () => {
    for (const [imgW, imgH] of [[1000, 800], [4000, 1200], [600, 3000], [2048, 2048]]) {
      const d: MapDims = { imgW: imgW!, imgH: imgH!, gridSize: 50 }
      const { cols, rows } = { cols: Math.ceil(imgW! / 50), rows: Math.ceil(imgH! / 50) }
      const span = Math.max(cols, rows)
      const room = corners(span)

      for (const pitch of [MIN_PITCH, 0.4, 0.8, 1.2, MAX_PITCH]) {
        for (const yaw of [0, 0.7, 1.9, 3.5, 5.6]) {
          for (const [tx, tz] of [[0, 0], [99999, 99999], [-99999, -99999]]) {
            const c = clampCamera(
              { yaw, pitch, dist: 99999, targetX: tx!, targetZ: tz! },
              d,
            )
            const p = cameraPosition(c)
            expect(Math.abs(p.x)).toBeLessThan(room.half)
            expect(Math.abs(p.z)).toBeLessThan(room.half)
            expect(p.y).toBeLessThan(room.ceiling)
            expect(p.y).toBeGreaterThan(room.floor)
          }
        }
      }
    }
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

  it('kehrt mit flipY die Zeilenreihenfolge um', () => {
    // Zwei Zeilen: oben offen, unten vernebelt.
    const g = createFogGrid(1, 2, 1)
    setFogCell(g, 0, 0, 0)
    const straight = fogGridToRGBA(g)
    expect(straight[0]).toBe(0) // erste Zeile offen
    expect(straight[4]).toBe(255) // zweite Zeile vernebelt

    const flipped = fogGridToRGBA(g, true)
    expect(flipped[0]).toBe(255) // jetzt zuerst die vernebelte Zeile
    expect(flipped[4]).toBe(0)
  })

  it('laesst flipY die Spalten unangetastet', () => {
    const g = createFogGrid(2, 2, 1)
    setFogCell(g, 0, 0, 0) // links oben
    const flipped = fogGridToRGBA(g, true)
    // Nach der Umkehr muss die offene Zelle in der ZWEITEN Zeile links stehen.
    expect(flipped[4 * 2]).toBe(0)
    expect(flipped[4 * 3]).toBe(255)
  })
})

describe('erodeOpenArea — weiche Kante nach innen', () => {
  it('laesst vernebelte Zellen unangetastet vernebelt', () => {
    const g = createFogGrid(9, 9, 1)
    setFogCell(g, 4, 4, 0)
    const e = erodeOpenArea(g, 3)
    expect(getFogCell(e, 0, 0)).toBe(1)
    expect(getFogCell(e, 8, 8)).toBe(1)
  })

  it('haelt die Mitte eines grossen offenen Bereichs frei', () => {
    const g = createFogGrid(21, 21, 1)
    for (let c = 4; c <= 16; c++) for (let r = 4; r <= 16; r++) setFogCell(g, c, r, 0)
    const e = erodeOpenArea(g, 2.5)
    expect(getFogCell(e, 10, 10)).toBeLessThan(0.05)
  })

  it('laesst den Nebel an der Grenze nach innen kriechen', () => {
    const g = createFogGrid(21, 21, 1)
    for (let c = 4; c <= 16; c++) for (let r = 4; r <= 16; r++) setFogCell(g, c, r, 0)
    const e = erodeOpenArea(g, 3)
    // Direkt innen an der Grenze noch deutlich gedaempft, weiter innen klarer.
    expect(getFogCell(e, 4, 10)).toBeGreaterThan(0.3)
    expect(getFogCell(e, 4, 10)).toBeGreaterThan(getFogCell(e, 6, 10))
  })

  it('ist NIEMALS durchlaessiger als die Eingabe — die zentrale Zusage', () => {
    const g = createFogGrid(24, 18, 1)
    // Gemischte Lage: Sicht, Erinnerung, Blackout, einzelne Luecken.
    for (let c = 3; c <= 9; c++) for (let r = 3; r <= 9; r++) setFogCell(g, c, r, 0)
    for (let c = 12; c <= 18; c++) for (let r = 6; r <= 12; r++) setFogCell(g, c, r, 0.55)
    setFogCell(g, 20, 2, 0)
    setFogCell(g, 6, 6, 1)
    for (const radius of [1, 2.5, 5]) {
      const e = erodeOpenArea(g, radius)
      for (let i = 0; i < g.data.length; i++) {
        expect(e.data[i]!).toBeGreaterThanOrEqual(g.data[i]! - 1e-6)
      }
    }
  })
})

describe('fogMaskRGBA — drei Kanaele, drei Aufgaben', () => {
  it('legt Boeschung nach R, harte Grenze nach G, Abdunklung nach B', () => {
    const hard = createFogGrid(3, 1, 1)
    setFogCell(hard, 1, 0, 0)
    const sloped = smoothFogGrid(hard, 3)
    const dark = erodeOpenArea(hard, 3)

    const rgba = fogMaskRGBA(sloped, hard, dark)
    // Zelle 0 ist HART vernebelt. Die nach aussen geboeschte Fassung hat sie
    // geoeffnet (R < 255) — die Abdunklung darf das nicht mitmachen (B = 255).
    expect(rgba[0]).toBeLessThan(255)
    expect(rgba[1]).toBe(255)
    expect(rgba[2]).toBe(255)
    // Zelle 1 ist offen; die Abdunklung kriecht hier von beiden Seiten herein.
    expect(rgba[5]).toBe(0)
    expect(rgba[6]).toBeGreaterThan(0)
  })

  it('haelt B ueberall mindestens so dicht wie G', () => {
    const hard = createFogGrid(12, 12, 1)
    for (let c = 3; c <= 8; c++) for (let r = 3; r <= 8; r++) setFogCell(hard, c, r, 0)
    const rgba = fogMaskRGBA(smoothFogGrid(hard, 3), hard, erodeOpenArea(hard, 3))
    for (let i = 0; i < 12 * 12; i++) {
      expect(rgba[i * 4 + 2]!).toBeGreaterThanOrEqual(rgba[i * 4 + 1]!)
    }
  })

  it('weist ungleich grosse Gitter zurueck', () => {
    const a = createFogGrid(2, 2, 1)
    const b = createFogGrid(3, 3, 1)
    expect(() => fogMaskRGBA(a, b, a)).toThrow()
    expect(() => fogMaskRGBA(a, a, b)).toThrow()
  })

  it('kehrt mit flipY alle Kanaele gemeinsam um', () => {
    const hard = createFogGrid(1, 2, 1)
    setFogCell(hard, 0, 0, 0)
    const rgba = fogMaskRGBA(hard, hard, hard, true)
    expect(rgba[1]).toBe(255)
    expect(rgba[5]).toBe(0)
  })
})

describe('light3dFor', () => {
  it('liefert fuer jede Tageszeit eine Stimmung', () => {
    for (const t of ['morning', 'noon', 'evening', 'night']) {
      const l = light3dFor(t)
      expect(l.sunIntensity).toBeGreaterThan(0)
      expect(l.fogVeil).toBeGreaterThanOrEqual(0)
      expect(l.fogVeil).toBeLessThanOrEqual(1)
    }
  })

  it('macht die Nacht dunkler und verhuellender als den Mittag', () => {
    expect(light3dFor('night').sunIntensity).toBeLessThan(light3dFor('noon').sunIntensity)
    expect(light3dFor('night').fogVeil).toBeGreaterThan(light3dFor('noon').fogVeil)
  })

  it('haelt den Schleier unter voller Deckkraft — auch das Unerforschte soll Nebel sein, keine Wand', () => {
    for (const t of ['morning', 'noon', 'evening', 'night']) {
      expect(light3dFor(t).fogVeil).toBeLessThan(1)
    }
  })

  it('macht den Nebel heller als den Boden, sonst liest er sich nicht als Nebel', () => {
    for (const t of ['morning', 'noon', 'evening', 'night']) {
      const l = light3dFor(t)
      // Grob ueber die Summe der Kanaele — es geht nur um hell gegen dunkel.
      const bright = (hex: number) => (hex >> 16 & 255) + (hex >> 8 & 255) + (hex & 255)
      expect(bright(l.fogNear)).toBeGreaterThan(bright(l.groundColor))
      expect(bright(l.fogFar)).toBeGreaterThan(bright(l.fogNear))
    }
  })

  it('faellt bei unbekannter Tageszeit auf Mittag zurueck', () => {
    expect(light3dFor('quatsch')).toEqual(light3dFor('noon'))
  })
})

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

  it('laesst Sicht die Erinnerung ueberschreiben', () => {
    const g = buildFogGridFromCells(5, 5, [[2, 2]], [[2, 2]], [])
    expect(getFogCell(g, 2, 2)).toBe(0)
  })
})
