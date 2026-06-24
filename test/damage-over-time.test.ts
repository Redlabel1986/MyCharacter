import { describe, it, expect } from 'vitest'
import {
  parseConditionParams,
  buildConditionParamLabels,
  parseDiceFormula,
  rollConditionDamage,
  isCumulativeBleed,
  isDotCondition,
  DOT_DEFAULT_AMOUNT,
} from '../shared/damage-over-time'

describe('parseConditionParams', () => {
  it('liest getrennte dmg- und dur-Labels', () => {
    const p = parseConditionParams(['dmg:poisoned:1W6', 'dur:poisoned:3'])
    expect(p.damage).toEqual({ poisoned: '1W6' })
    expect(p.duration).toEqual({ poisoned: 3 })
    expect(p.rest).toEqual([])
  })

  it('haelt echte Frei-Text-Labels in rest', () => {
    const p = parseConditionParams(['benommen', 'dmg:burning:5', 'eigenes Label'])
    expect(p.damage).toEqual({ burning: '5' })
    expect(p.rest).toEqual(['benommen', 'eigenes Label'])
  })

  it('leerer Schadenswert faellt auf "1" zurueck', () => {
    const p = parseConditionParams(['dmg:bleeding:'])
    expect(p.damage.bleeding).toBe('1')
  })

  it('ignoriert dur mit 0 Runden', () => {
    const p = parseConditionParams(['dur:stunned:0'])
    expect(p.duration).toEqual({})
  })

  it('migriert Legacy dmg:<cond>:<schaden>:<runden> in Schaden + Dauer', () => {
    const p = parseConditionParams(['dmg:poisoned:1W6:3'])
    expect(p.damage).toEqual({ poisoned: '1W6' })
    expect(p.duration).toEqual({ poisoned: 3 })
  })

  it('migriert Legacy bleed:N als kumulatives Bluten ohne Dauer', () => {
    const p = parseConditionParams(['bleed:4'])
    expect(p.damage).toEqual({ bleeding: '4' })
    expect(p.duration).toEqual({})
  })

  it('dur gilt auch fuer nicht-schaedigende Zustaende', () => {
    const p = parseConditionParams(['dur:stunned:2'])
    expect(p.duration).toEqual({ stunned: 2 })
    expect(p.damage).toEqual({})
  })
})

describe('buildConditionParamLabels', () => {
  it('ist roundtrip-stabil mit parseConditionParams', () => {
    const labels = ['benommen', 'dmg:poisoned:1W6', 'dur:poisoned:3']
    const p = parseConditionParams(labels)
    const out = buildConditionParamLabels(p)
    expect(out).toContain('benommen')
    expect(out).toContain('dmg:poisoned:1W6')
    expect(out).toContain('dur:poisoned:3')
    // erneut parsen ergibt dieselben Parameter
    expect(parseConditionParams(out)).toEqual(p)
  })

  it('laesst Dauer <= 0 weg', () => {
    const out = buildConditionParamLabels({ damage: {}, duration: { x: 0 }, rest: [] })
    expect(out).toEqual([])
  })
})

describe('parseDiceFormula', () => {
  it('parst NWM mit Modifikator', () => {
    expect(parseDiceFormula('2W8+1')).toEqual({ count: 2, sides: 8, mod: 1 })
  })

  it('akzeptiert d-Notation und negativen Modifikator', () => {
    expect(parseDiceFormula('1d20-2')).toEqual({ count: 1, sides: 20, mod: -2 })
  })

  it('toleriert Leerzeichen', () => {
    expect(parseDiceFormula(' 3 W 6 + 2 ')).toEqual({ count: 3, sides: 6, mod: 2 })
  })

  it('lehnt Unsinn und Grenzwerte ab', () => {
    expect(parseDiceFormula('abc')).toBeNull()
    expect(parseDiceFormula('5')).toBeNull()
    expect(parseDiceFormula('0W6')).toBeNull()
    expect(parseDiceFormula('1W1')).toBeNull()
    expect(parseDiceFormula('99W6')).toBeNull()
  })
})

describe('rollConditionDamage', () => {
  it('behandelt feste Zahlen ohne Wuerfel', () => {
    const r = rollConditionDamage('5')
    expect(r.damage).toBe(5)
    expect(r.detail).toBe('fest 5')
  })

  it('wuerfelt deterministisch mit injiziertem RNG', () => {
    // rng=0 -> jede Augenzahl wird floor(0*sides)+1 = 1
    const r = rollConditionDamage('3W6', () => 0)
    expect(r.damage).toBe(3) // 1+1+1
    expect(r.detail).toContain('= 3')
  })

  it('addiert den Modifikator', () => {
    // rng nahe 1 -> maximale Augen; 1W6 -> 6, +2 = 8
    const r = rollConditionDamage('1W6+2', () => 0.999)
    expect(r.damage).toBe(8)
  })

  it('clamped Schaden auf >= 0 bei negativem Modifikator', () => {
    const r = rollConditionDamage('1W6-10', () => 0)
    expect(r.damage).toBe(0)
  })

  it('liefert 0 bei ungueltiger Formel', () => {
    const r = rollConditionDamage('quatsch')
    expect(r.damage).toBe(0)
    expect(r.detail).toContain('ungueltig')
  })
})

describe('isCumulativeBleed', () => {
  it('ist nur fuer bleeding mit reiner Zahl und ohne Dauer wahr', () => {
    expect(isCumulativeBleed('bleeding', '4', false)).toBe(true)
    expect(isCumulativeBleed('bleeding', '4', true)).toBe(false)
    expect(isCumulativeBleed('bleeding', '1W6', false)).toBe(false)
    expect(isCumulativeBleed('poisoned', '4', false)).toBe(false)
  })
})

describe('isDotCondition / Defaults', () => {
  it('erkennt DoT-faehige Zustaende', () => {
    expect(isDotCondition('poisoned')).toBe(true)
    expect(isDotCondition('stunned')).toBe(false)
  })

  it('hat einen Default-Schaden je DoT-Zustand', () => {
    expect(DOT_DEFAULT_AMOUNT.poisoned).toBe('1W6')
    expect(DOT_DEFAULT_AMOUNT.bleeding).toBe('1')
  })
})
