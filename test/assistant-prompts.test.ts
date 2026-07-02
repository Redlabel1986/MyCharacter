import { describe, it, expect } from 'vitest'
import {
  buildSuggestPrompt,
  buildGeneratePrompt,
  parseAiJson,
  normalizeSuggestion,
  clampCustomData,
  clampHtbahData,
  htbahPoolForLevel,
  type AssistantInput,
  type GenerateInput,
} from '../server/utils/assistant'
import type { RuleSystemDefinition } from '../shared/rule-system'

const base: AssistantInput = {
  system: 'dnd5e',
  systemLabel: 'Dungeons & Dragons 5e (2014)',
  concept: 'Ein mürrischer Zwergen-Schmied, der widerwillig zum Abenteurer wurde',
  backstory: '',
  race: '',
  name: '',
  level: 1,
}

describe('buildSuggestPrompt', () => {
  it('enthält Regelwerk, Konzept und Level im User-Prompt', () => {
    const p = buildSuggestPrompt(base)
    expect(p.user).toContain('Dungeons & Dragons 5e (2014)')
    expect(p.user).toContain('mürrischer Zwergen-Schmied')
    expect(p.user).toContain('Startlevel: 1')
  })

  it('markiert vorgegebene Rasse/Name als fest', () => {
    const p = buildSuggestPrompt({ ...base, race: 'Zwerg', name: 'Bargin' })
    expect(p.user).toContain('FEST vorgegeben')
    expect(p.user).toContain('Zwerg')
    expect(p.user).toContain('Bargin')
  })

  it('listet bei Custom-Systemen Attribute und Skills der Definition', () => {
    const p = buildSuggestPrompt({
      ...base,
      system: 'custom',
      systemLabel: 'Mein Hausregelwerk',
      definition: {
        attributes: [{ key: 'KOR', label: 'Körper', default: 10, min: 1, max: 20 }],
        skills: [{ key: 'kampf', label: 'Kampf', attribute: 'KOR', default: 0 }],
        hp: { maxFormula: '20 + KOR' },
        dice: { mechanic: 'roll-over', dieSize: 20 },
      },
    })
    expect(p.user).toContain('Körper')
    expect(p.user).toContain('Kampf')
  })
})

describe('buildGeneratePrompt', () => {
  const gen: GenerateInput = {
    ...base,
    name: 'Bargin Kupferfaust',
    race: 'Zwerg',
    className: 'Kämpfer',
    conceptSummary: 'Mürrischer Schmied auf Wanderschaft.',
    level: 5,
    backstory: 'In den Minen von Norhelm aufgewachsen.',
  }

  it('enthält das Blank-Schema und die Level-Anweisung des Systems', () => {
    const p = buildGeneratePrompt(gen)
    expect(p.system).toContain('"abilities"') // D&D-Blank-Schema ist eingebettet
    expect(p.system).toContain('Proficiency')  // Level-Hinweis für D&D
    expect(p.user).toContain('Startlevel: 5')
  })

  it('übergibt Eckdaten und Vorgeschichte im User-Prompt', () => {
    const p = buildGeneratePrompt(gen)
    expect(p.user).toContain('Bargin Kupferfaust')
    expect(p.user).toContain('Zwerg')
    expect(p.user).toContain('Kämpfer')
    expect(p.user).toContain('Minen von Norhelm')
  })
})

describe('parseAiJson', () => {
  it('parst reines JSON und strippt Code-Fences', () => {
    expect(parseAiJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseAiJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('wirft bei ungültigem JSON', () => {
    expect(() => parseAiJson('kein json')).toThrow()
  })
})

describe('normalizeSuggestion', () => {
  it('übernimmt KI-Felder als Strings mit Fallback ""', () => {
    const s = normalizeSuggestion({ name: 'Ada', race: 'Elf', className: 'Magier' }, base)
    expect(s).toEqual({
      name: 'Ada', race: 'Elf', raceReason: '', className: 'Magier',
      classReason: '', conceptSummary: '',
    })
  })
  it('Nutzer-Vorgaben überschreiben die KI-Antwort', () => {
    const s = normalizeSuggestion(
      { name: 'Falsch', race: 'Ork' },
      { ...base, name: 'Bargin', race: 'Zwerg' },
    )
    expect(s.name).toBe('Bargin')
    expect(s.race).toBe('Zwerg')
  })
})

describe('clampCustomData', () => {
  const def: RuleSystemDefinition = {
    attributes: [
      { key: 'KOR', label: 'Körper', default: 10, min: 1, max: 20 },
      { key: 'GEI', label: 'Geist', default: 8, min: 1, max: 20 },
    ],
    skills: [
      { key: 'kampf', label: 'Kampf', attribute: 'KOR', default: 5 },
      { key: 'wissen', label: 'Wissen', attribute: 'GEI', default: 3 },
    ],
    hp: { maxFormula: '20 + KOR' },
    dice: { mechanic: 'roll-over', dieSize: 20 },
  }

  it('klammert Attribute über max auf max und unter min auf min', () => {
    const out = clampCustomData(
      { attributes: { KOR: 999, GEI: -5 }, skills: {} },
      def,
    )
    expect((out.attributes as Record<string, number>).KOR).toBe(20)
    expect((out.attributes as Record<string, number>).GEI).toBe(1)
  })

  it('rundet nicht-ganzzahlige Attributwerte', () => {
    const out = clampCustomData({ attributes: { KOR: 12.6, GEI: 7.2 }, skills: {} }, def)
    expect((out.attributes as Record<string, number>).KOR).toBe(13)
    expect((out.attributes as Record<string, number>).GEI).toBe(7)
  })

  it('verwirft Attribut-/Skill-Keys, die die Definition nicht kennt', () => {
    const out = clampCustomData(
      { attributes: { KOR: 10, UNBEKANNT: 42 }, skills: { kampf: 5, GEHEIM: 99 } },
      def,
    )
    expect(out.attributes).not.toHaveProperty('UNBEKANNT')
    expect(out.skills).not.toHaveProperty('GEHEIM')
  })

  it('setzt nicht-numerische Attribut-/Skill-Werte auf den Default zurück', () => {
    const out = clampCustomData(
      { attributes: { KOR: 'zwölf', GEI: null }, skills: { kampf: 'stark', wissen: undefined } },
      def,
    )
    expect((out.attributes as Record<string, number>).KOR).toBe(10)
    expect((out.attributes as Record<string, number>).GEI).toBe(8)
    expect((out.skills as Record<string, number>).kampf).toBe(5)
    expect((out.skills as Record<string, number>).wissen).toBe(3)
  })

  it('lässt Skill-Zahlen ohne min/max-Grenzen unverändert', () => {
    const out = clampCustomData({ attributes: {}, skills: { kampf: 999 } }, def)
    expect((out.skills as Record<string, number>).kampf).toBe(999)
  })

  it('lässt andere Datenfelder unangetastet', () => {
    const out = clampCustomData(
      { attributes: {}, skills: {}, resources: { hp: { current: 5, max: 20 } }, notes: 'hallo' },
      def,
    )
    expect(out.resources).toEqual({ hp: { current: 5, max: 20 } })
    expect(out.notes).toBe('hallo')
  })

  it('mutiert die Eingabe nicht', () => {
    const input = { attributes: { KOR: 999 }, skills: {} }
    const snapshot = JSON.parse(JSON.stringify(input))
    clampCustomData(input, def)
    expect(input).toEqual(snapshot)
  })
})

describe('htbahPoolForLevel', () => {
  it('Level 1 = 400, +50 pro Level darueber', () => {
    expect(htbahPoolForLevel(1)).toBe(400)
    expect(htbahPoolForLevel(3)).toBe(500)
    expect(htbahPoolForLevel(5)).toBe(600)
  })
})

describe('clampHtbahData', () => {
  const skill = (id: string, spentPoints: unknown) => ({
    id, name: `Skill ${id}`, talent: 'handeln', spentPoints,
    modifier: 0, dayBonus: 0, nightBonus: 0, note: '',
  })
  const sumSpent = (out: Record<string, unknown>) =>
    (out.skills as { spentPoints: number }[]).reduce((a, s) => a + s.spentPoints, 0)

  it('setzt pointsPool.total hart auf den Level-Wert', () => {
    const out = clampHtbahData({ pointsPool: { total: 9000, racePoints: 0 }, skills: [] }, 1)
    expect((out.pointsPool as { total: number }).total).toBe(400)
    const out3 = clampHtbahData({ pointsPool: { total: 100, racePoints: 0 }, skills: [] }, 3)
    expect((out3.pointsPool as { total: number }).total).toBe(500)
  })

  it('skaliert spentPoints herunter, wenn die Summe den Pool uebersteigt', () => {
    const out = clampHtbahData({
      pointsPool: { total: 400, racePoints: 0 },
      skills: [skill('s1', 100), skill('s2', 100), skill('s3', 100), skill('s4', 100), skill('s5', 100), skill('s6', 100)],
    }, 1)
    expect(sumSpent(out)).toBeLessThanOrEqual(400)
    // Proportional: 600 -> 400 => jeder Skill floor(100 * 2/3) = 66
    expect((out.skills as { spentPoints: number }[])[0]!.spentPoints).toBe(66)
  })

  it('laesst Verteilungen innerhalb des Budgets unveraendert', () => {
    const out = clampHtbahData({
      pointsPool: { total: 400, racePoints: 0 },
      skills: [skill('s1', 80), skill('s2', 70), skill('s3', 50)],
    }, 1)
    expect(sumSpent(out)).toBe(200)
    expect((out.skills as { spentPoints: number }[])[0]!.spentPoints).toBe(80)
  })

  it('Nachteile und Vorgeschichte vergroessern den Pool, Vorteile verkleinern ihn', () => {
    const out = clampHtbahData({
      pointsPool: { total: 400, racePoints: 10 },
      advantages: [{ id: 'a1', name: 'Reich', cost: 30, note: '' }],
      disadvantages: [{ id: 'd1', name: 'Arm', cost: 50, note: '' }],
      backstory: { text: 'harte Kindheit', points: 20 },
      skills: [skill('s1', 100), skill('s2', 100), skill('s3', 100), skill('s4', 100), skill('s5', 100)],
    }, 1)
    // Pool = 400 + 10 + 50 - 30 + 20 = 450 < 500 verteilt => runterskaliert
    expect(sumSpent(out)).toBeLessThanOrEqual(450)
  })

  it('klammert einzelne Skills auf max. 100 Punkte', () => {
    const out = clampHtbahData({
      pointsPool: { total: 400, racePoints: 0 },
      skills: [skill('s1', 250)],
    }, 1)
    expect((out.skills as { spentPoints: number }[])[0]!.spentPoints).toBe(100)
  })

  it('normalisiert kaputte Werte (Strings, negative Zahlen) auf sichere Defaults', () => {
    const out = clampHtbahData({
      pointsPool: { total: 400, racePoints: -50 },
      advantages: [{ id: 'a1', name: 'X', cost: -20, note: '' }],
      backstory: { text: '', points: 'viele' },
      skills: [skill('s1', 'achtzig'), skill('s2', -10)],
    }, 1)
    expect((out.pointsPool as { racePoints: number }).racePoints).toBe(0)
    expect((out.advantages as { cost: number }[])[0]!.cost).toBe(0)
    expect((out.backstory as { points: number }).points).toBe(0)
    expect((out.skills as { spentPoints: number }[])[0]!.spentPoints).toBe(0)
    expect((out.skills as { spentPoints: number }[])[1]!.spentPoints).toBe(0)
  })

  it('mutiert die Eingabe nicht und laesst andere Felder unangetastet', () => {
    const input = {
      pointsPool: { total: 999, racePoints: 0 },
      skills: [skill('s1', 500)],
      inventory: 'Seil, Fackel',
      hp: { max: 100, current: 100 },
    }
    const snapshot = JSON.parse(JSON.stringify(input))
    const out = clampHtbahData(input, 1)
    expect(input).toEqual(snapshot)
    expect(out.inventory).toBe('Seil, Fackel')
    expect(out.hp).toEqual({ max: 100, current: 100 })
  })
})
