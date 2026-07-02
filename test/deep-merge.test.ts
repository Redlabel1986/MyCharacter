import { describe, it, expect } from 'vitest'
import { deepMerge, isPlainObject } from '../server/utils/deep-merge'

describe('isPlainObject', () => {
  it('erkennt Plain-Objects, aber keine Arrays/null', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject('x')).toBe(false)
  })
})

describe('deepMerge', () => {
  it('merged verschachtelte Objekte rekursiv, source gewinnt', () => {
    const target = { a: 1, nested: { x: 1, y: 2 } }
    const source = { nested: { y: 9 } }
    expect(deepMerge(target, source)).toEqual({ a: 1, nested: { x: 1, y: 9 } })
  })

  it('ersetzt Arrays komplett statt zu mergen', () => {
    const out = deepMerge({ skills: [{ id: 'a' }] }, { skills: [{ id: 'b' }, { id: 'c' }] })
    expect(out.skills).toEqual([{ id: 'b' }, { id: 'c' }])
  })

  it('ignoriert undefined in source und mutiert target nicht', () => {
    const target = { a: 1, b: 2 }
    const out = deepMerge(target, { a: undefined as unknown as number, b: 3 })
    expect(out).toEqual({ a: 1, b: 3 })
    expect(target).toEqual({ a: 1, b: 2 })
  })
})
