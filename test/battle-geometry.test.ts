import { describe, it, expect } from 'vitest'
import {
  snapToGrid,
  clampToMoveRange,
  distancePointToSegment,
  polygonPointsAttr,
  pointsToPath,
  buildGridSvg,
} from '../shared/battle-geometry'

describe('snapToGrid (square)', () => {
  it('snappt auf den Zell-Mittelpunkt', () => {
    // gridSize 50: Zelle [0,50) -> Mittelpunkt 25
    expect(snapToGrid(10, 10, 'square', 50)).toEqual({ x: 25, y: 25 })
    expect(snapToGrid(60, 0, 'square', 50)).toEqual({ x: 75, y: 25 })
  })

  it('ist idempotent auf einem bereits gesnappten Punkt', () => {
    const once = snapToGrid(137, 88, 'square', 50)
    expect(snapToGrid(once.x, once.y, 'square', 50)).toEqual(once)
  })
})

describe('snapToGrid (hex)', () => {
  it('snappt auf ein Hex-Zentrum (versetzte Spalten)', () => {
    const r = snapToGrid(0, 0, 'hex', 50)
    expect(r.x).toBeCloseTo(0)
    expect(r.y).toBeCloseTo(0)
  })

  it('versetzt ungerade Spalten um eine halbe Reihe', () => {
    const s = 25 // gridSize/2
    const colStep = 1.5 * s
    const rowStep = Math.sqrt(3) * s
    // nahe Spalte 1 (ungerade) -> yOffset = rowStep/2
    const r = snapToGrid(colStep, rowStep / 2, 'hex', 50)
    expect(r.x).toBeCloseTo(colStep)
    expect(r.y).toBeCloseTo(rowStep / 2)
  })
})

describe('clampToMoveRange', () => {
  const start = { x: 100, y: 100, moveRange: 2 } // 2 Zellen * 50px = 100px Chebyshev

  it('laesst Ziele innerhalb der Reichweite unveraendert', () => {
    expect(clampToMoveRange(150, 80, start, 50)).toEqual({ x: 150, y: 80 })
  })

  it('klemmt jede Achse einzeln (Chebyshev/Max-Norm)', () => {
    expect(clampToMoveRange(500, 500, start, 50)).toEqual({ x: 200, y: 200 })
    expect(clampToMoveRange(-500, 130, start, 50)).toEqual({ x: 0, y: 130 })
  })

  it('macht nichts bei moveRange <= 0 oder ungueltigem Raster', () => {
    expect(clampToMoveRange(999, 999, { x: 0, y: 0, moveRange: 0 }, 50)).toEqual({ x: 999, y: 999 })
    expect(clampToMoveRange(999, 999, start, 0)).toEqual({ x: 999, y: 999 })
  })
})

describe('distancePointToSegment', () => {
  it('misst den Lotabstand auf die Strecke', () => {
    // Strecke (0,0)-(10,0), Punkt (5,3) -> Abstand 3
    expect(distancePointToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3)
  })

  it('faellt am Segment-Ende auf den Endpunkt-Abstand zurueck', () => {
    // Punkt (20,0) jenseits des Endes (10,0) -> Abstand 10
    expect(distancePointToSegment(20, 0, 0, 0, 10, 0)).toBeCloseTo(10)
  })

  it('behandelt ein entartetes (Punkt-)Segment', () => {
    expect(distancePointToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5)
  })
})

describe('polygonPointsAttr', () => {
  it('formatiert Punkte mit 2 Nachkommastellen', () => {
    expect(polygonPointsAttr([{ x: 1, y: 2 }, { x: 3.456, y: 4 }])).toBe('1.00,2.00 3.46,4.00')
  })

  it('liefert leeren String fuer keine Punkte', () => {
    expect(polygonPointsAttr([])).toBe('')
  })
})

describe('pointsToPath', () => {
  it('baut ein M…L…-Pfad-d-Attribut', () => {
    expect(pointsToPath([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }]))
      .toBe('M 0 0 L 5 5 L 10 0')
  })

  it('liefert leeren String fuer keine Punkte', () => {
    expect(pointsToPath([])).toBe('')
  })
})

describe('buildGridSvg', () => {
  it('liefert leeren String ohne Bildmasse', () => {
    expect(buildGridSvg('square', 50, '#000', 0, 100)).toBe('')
  })

  it('nutzt ein <pattern> fuer das Quadrat-Raster', () => {
    const svg = buildGridSvg('square', 50, '#abc', 200, 100)
    expect(svg).toContain('<pattern')
    expect(svg).toContain('width="200"')
    expect(svg).toContain('#abc')
  })

  it('rendert <polygon>-Hexe fuer das Hex-Raster', () => {
    const svg = buildGridSvg('hex', 50, '#fff', 200, 200)
    expect(svg).toContain('<polygon')
    expect(svg).not.toContain('<pattern')
  })
})
