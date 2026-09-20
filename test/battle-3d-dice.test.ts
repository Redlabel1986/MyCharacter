import { describe, it, expect } from 'vitest'
import { specFor, faceNormal, type DieSpec } from '../app/composables/useBattle3DDice'

/**
 * Die Wuerfelkoerper sind aus handgetippten Eckpunkt-Indizes gebaut — der
 * klassische Ort fuer einen verdrehten Index, der am Bildschirm als Loch oder
 * Knick im Wuerfel auffiele. Diese Tests pruefen die Geometrie, ohne sie zu
 * rendern.
 */

const SIDES = [4, 6, 8, 10, 12, 20] as const

const planeDeviation = (spec: DieSpec, face: number[]): number => {
  const n = faceNormal(spec.verts, face)
  const a = spec.verts[face[0]!]!
  const d0 = a[0] * n[0] + a[1] * n[1] + a[2] * n[2]
  let worst = 0
  for (const vi of face) {
    const v = spec.verts[vi]!
    const d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2]
    worst = Math.max(worst, Math.abs(d - d0))
  }
  return worst
}

describe('Wuerfelgeometrie', () => {
  it('hat je Wuerfel so viele Flaechen wie Seiten', () => {
    for (const s of SIDES) {
      expect(specFor(s).faces.length).toBe(s)
    }
  })

  it('jede Flaeche ist eben — kein verdrehter Eckpunkt-Index', () => {
    for (const s of SIDES) {
      const spec = specFor(s)
      for (const face of spec.faces) {
        expect(planeDeviation(spec, face)).toBeLessThan(1e-6)
      }
    }
  })

  it('jeder Eckpunkt liegt auf dem Umkreis — der Koerper ist regelmaessig', () => {
    for (const s of SIDES) {
      const spec = specFor(s)
      const radii = spec.verts.map((v) => Math.hypot(v[0], v[1], v[2]))
      // W10: Spitzen bei 1, Ring etwas darunter — zwei Radien sind erlaubt.
      const distinct = new Set(radii.map((r) => r.toFixed(4)))
      expect(distinct.size).toBeLessThanOrEqual(s === 10 ? 2 : 1)
    }
  })

  it('alle Flaechennormalen zeigen vom Mittelpunkt weg', () => {
    for (const s of SIDES) {
      const spec = specFor(s)
      for (const face of spec.faces) {
        const n = faceNormal(spec.verts, face)
        const c = [0, 1, 2].map((k) => face.reduce((sum, vi) => sum + spec.verts[vi]![k]!, 0) / face.length)
        expect(n[0] * c[0]! + n[1] * c[1]! + n[2] * c[2]!).toBeGreaterThan(0)
      }
    }
  })

  it('jeder Eckpunkt gehoert zu mindestens drei Flaechen — der Koerper ist geschlossen', () => {
    for (const s of SIDES) {
      const spec = specFor(s)
      const counts = new Array(spec.verts.length).fill(0)
      for (const face of spec.faces) for (const vi of face) counts[vi]++
      for (const c of counts) expect(c).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('Wuerfelbeschriftung', () => {
  it('traegt jeden Wert genau einmal', () => {
    const expected: Record<number, string[]> = {
      6: ['1', '2', '3', '4', '5', '6'],
      8: ['1', '2', '3', '4', '5', '6', '7', '8'],
      10: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
      12: [...Array(12).keys()].map((i) => String(i + 1)),
      20: [...Array(20).keys()].map((i) => String(i + 1)),
    }
    for (const [s, labels] of Object.entries(expected)) {
      expect([...specFor(Number(s)).labels].sort()).toEqual([...labels].sort())
    }
  })

  it('beschriftet den W4 an den Eckpunkten, nicht auf den Flaechen', () => {
    const d4 = specFor(4)
    expect(d4.cornerLabels).toBe(true)
    expect(d4.labels).toEqual(['1', '2', '3', '4'])
    expect(d4.labels.length).toBe(d4.verts.length)
  })

  it('gegenueberliegende Flaechen ergeben zusammen die Wuerfelsumme (7, 9, 9, 13, 21)', () => {
    const sums: Record<number, number> = { 6: 7, 8: 9, 10: 9, 12: 13, 20: 21 }
    for (const [sStr, sum] of Object.entries(sums)) {
      const spec = specFor(Number(sStr))
      const normals = spec.faces.map((f) => faceNormal(spec.verts, f))
      for (let i = 0; i < normals.length; i++) {
        // Gegenueber = Normale zeigt in die Gegenrichtung.
        let best = -1
        let bestDot = 1
        for (let j = 0; j < normals.length; j++) {
          if (i === j) continue
          const d = normals[i]![0] * normals[j]![0] + normals[i]![1] * normals[j]![1] + normals[i]![2] * normals[j]![2]
          if (d < bestDot) {
            bestDot = d
            best = j
          }
        }
        expect(bestDot).toBeLessThan(-0.99)
        expect(Number(spec.labels[i]) + Number(spec.labels[best])).toBe(sum)
      }
    }
  })

  it('zeigt auf dem Zehner-W10 00 bis 90', () => {
    const tens = specFor(10, true)
    expect([...tens.labels].sort()).toEqual(['00', '10', '20', '30', '40', '50', '60', '70', '80', '90'])
  })
})
