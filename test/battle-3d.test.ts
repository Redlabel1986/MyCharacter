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
  light3dFor,
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

describe('fogMaskRGBA — Trennung von Hoehe und Deckkraft', () => {
  it('legt die geboeschte Fassung nach R und die harte nach G', () => {
    const hard = createFogGrid(3, 1, 1)
    setFogCell(hard, 1, 0, 0)
    const sloped = smoothFogGrid(hard, 3)

    const rgba = fogMaskRGBA(sloped, hard)
    // Zelle 0 ist HART vernebelt (G = 255), die Boeschung hat sie aber
    // geoeffnet (R < 255). Genau diese Trennung verhindert das Leck.
    expect(rgba[1]).toBe(255)
    expect(rgba[0]).toBeLessThan(255)
    // Zelle 1 ist in beiden Fassungen offen.
    expect(rgba[4]).toBe(0)
    expect(rgba[5]).toBe(0)
  })

  it('oeffnet in G niemals eine Zelle, die hart vernebelt ist', () => {
    const hard = createFogGrid(9, 9, 1)
    setFogCell(hard, 4, 4, 0)
    const sloped = smoothFogGrid(hard, 4)
    const rgba = fogMaskRGBA(sloped, hard)
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const g = rgba[(row * 9 + col) * 4 + 1]
        const expected = col === 4 && row === 4 ? 0 : 255
        expect(g).toBe(expected)
      }
    }
  })

  it('weist ungleich grosse Gitter zurueck', () => {
    expect(() => fogMaskRGBA(createFogGrid(2, 2, 1), createFogGrid(3, 3, 1))).toThrow()
  })

  it('kehrt mit flipY beide Kanaele gemeinsam um', () => {
    const hard = createFogGrid(1, 2, 1)
    setFogCell(hard, 0, 0, 0)
    const rgba = fogMaskRGBA(hard, hard, true)
    expect(rgba[1]).toBe(255)
    expect(rgba[5]).toBe(0)
  })
})

describe('light3dFor', () => {
  it('liefert fuer jede Tageszeit eine Stimmung', () => {
    for (const t of ['morning', 'noon', 'evening', 'night']) {
      const l = light3dFor(t)
      expect(l.sunIntensity).toBeGreaterThan(0)
      expect(l.groundDark).toBeGreaterThanOrEqual(0)
      expect(l.groundDark).toBeLessThanOrEqual(1)
    }
  })

  it('macht die Nacht dunkler als den Mittag', () => {
    expect(light3dFor('night').groundDark).toBeLessThan(light3dFor('noon').groundDark)
    expect(light3dFor('night').sunIntensity).toBeLessThan(light3dFor('noon').sunIntensity)
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
