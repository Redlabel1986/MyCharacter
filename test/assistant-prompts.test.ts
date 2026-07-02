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
    // 600 verteilt, Pool 400 => exakt 400 nach Skalierung
    expect(sumSpent(out)).toBe(400)
    const points = (out.skills as { spentPoints: number }[]).map((s) => s.spentPoints)
    for (const p of points) expect(p === 66 || p === 67).toBe(true)
  })

  it('skaliert spentPoints hoch, wenn Punkte uebrig sind — alle Punkte werden vergeben', () => {
    const out = clampHtbahData({
      pointsPool: { total: 400, racePoints: 0 },
      skills: [skill('s1', 40), skill('s2', 30), skill('s3', 20), skill('s4', 10)],
    }, 1)
    // 100 verteilt, Pool 400 => hochskaliert bis Summe = 400 (Cap 100/Skill)
    expect(sumSpent(out)).toBe(400)
    const points = (out.skills as { spentPoints: number }[]).map((s) => s.spentPoints)
    for (const p of points) expect(p).toBeLessThanOrEqual(100)
  })

  it('verteilt den Pool gleichmaessig, wenn alle Skills 0 Punkte haben', () => {
    const out = clampHtbahData({
      pointsPool: { total: 400, racePoints: 0 },
      skills: [skill('s1', 0), skill('s2', 0), skill('s3', 0), skill('s4', 0)],
    }, 1)
    expect(sumSpent(out)).toBe(400)
    expect((out.skills as { spentPoints: number }[])[0]!.spentPoints).toBe(100)
  })

  it('kann nicht ueber das Skill-Cap hinaus fuellen', () => {
    const out = clampHtbahData({
      pointsPool: { total: 400, racePoints: 0 },
      skills: [skill('s1', 50), skill('s2', 50)],
    }, 1)
    // Nur 2 Skills à Cap 100 => maximal 200 verteilbar
    expect(sumSpent(out)).toBe(200)
  })

  it('Nachteile und Vorgeschichte vergroessern den Pool, Vorteile verkleinern ihn', () => {
    const out = clampHtbahData({
      pointsPool: { total: 400, racePoints: 10 },
      advantages: [{ id: 'a1', name: 'Reich', cost: 30, note: '' }],
      disadvantages: [{ id: 'd1', name: 'Arm', cost: 50, note: '' }],
      backstory: { text: 'harte Kindheit', points: 20 },
      skills: [skill('s1', 100), skill('s2', 100), skill('s3', 100), skill('s4', 100), skill('s5', 100)],
    }, 1)
    // Pool = 400 + 10 + 50 - 30 + 20 = 450 => exakt ausgeschoepft
    expect(sumSpent(out)).toBe(450)
  })

  it('kuerzt ueberzogene Vorteilskosten, statt den Skill-Pool leerzufressen', () => {
    const out = clampHtbahData({
      pointsPool: { total: 400, racePoints: 0 },
      advantages: [{ id: 'a1', name: 'Superreich', cost: 500, note: '' }],
      skills: [skill('s1', 100), skill('s2', 100), skill('s3', 100), skill('s4', 100)],
    }, 1)
    // Vorteile max. halber Brutto-Pool (200) => Pool 200, Skills exakt 200
    expect((out.advantages as { cost: number }[])[0]!.cost).toBe(200)
    expect(sumSpent(out)).toBe(200)
  })

  it('liest Nachteil-Kosten auch aus dem value-Feld (KI-Robustheit)', () => {
    const out = clampHtbahData({
      pointsPool: { total: 400, racePoints: 0 },
      disadvantages: [{ id: 'd1', name: 'Arm', value: 50, note: '' }],
      skills: [skill('s1', 0), skill('s2', 0), skill('s3', 0), skill('s4', 0), skill('s5', 0)],
    }, 1)
    expect((out.disadvantages as { cost: number }[])[0]!.cost).toBe(50)
    expect(sumSpent(out)).toBe(450)
  })

  it('normalisiert talent-Werte, damit Skills im Bogen sichtbar bleiben', () => {
    const out = clampHtbahData({
      pointsPool: { total: 400, racePoints: 0 },
      skills: [
        { id: 's1', name: 'Recherche', talent: 'Wissen', spentPoints: 100 },
        { id: 's2', name: 'Verhandeln', talent: 'SOZIALES', spentPoints: 100 },
        { id: 's3', name: 'Klettern', talent: 'Action', spentPoints: 100 },
        { id: 's4', name: 'Schleichen', talent: 'handeln', spentPoints: 100 },
      ],
    }, 1)
    const talents = (out.skills as { talent: string }[]).map((s) => s.talent)
    expect(talents).toEqual(['wissen', 'soziales', 'handeln', 'handeln'])
  })

  it('fuellt fehlende Skill-Pflichtfelder auf (id, modifier, note, ...)', () => {
    const out = clampHtbahData({
      pointsPool: { total: 400, racePoints: 0 },
      skills: [
        { name: 'Beobachten', talent: 'wissen', spentPoints: 100 },
        { name: 'Reden', talent: 'soziales', spentPoints: 100 },
        { name: 'Laufen', talent: 'handeln', spentPoints: 100 },
        { name: 'Werfen', talent: 'handeln', spentPoints: 100 },
      ],
    }, 1)
    const s = (out.skills as Record<string, unknown>[])[0]!
    expect(s.id).toBe('s1')
    expect(s.modifier).toBe(0)
    expect(s.dayBonus).toBe(0)
    expect(s.nightBonus).toBe(0)
    expect(s.note).toBe('')
    expect((out.skills as Record<string, unknown>[])[1]!.id).toBe('s2')
  })

  it('akzeptiert spentPoints als numerische Strings', () => {
    const out = clampHtbahData({
      pointsPool: { total: 400, racePoints: 0 },
      skills: [skill('s1', '80'), skill('s2', '70'), skill('s3', '50'), skill('s4', '60')],
    }, 1)
    expect(sumSpent(out)).toBe(400)
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
    // Kaputte spentPoints werden 0 — dann fuellt die Verteilung den Pool
    // gleichmaessig bis zum Cap auf.
    expect((out.skills as { spentPoints: number }[])[0]!.spentPoints).toBe(100)
    expect((out.skills as { spentPoints: number }[])[1]!.spentPoints).toBe(100)
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
