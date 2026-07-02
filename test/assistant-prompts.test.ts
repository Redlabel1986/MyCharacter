import { describe, it, expect } from 'vitest'
import {
  buildSuggestPrompt,
  buildGeneratePrompt,
  parseAiJson,
  normalizeSuggestion,
  type AssistantInput,
  type GenerateInput,
} from '../server/utils/assistant'

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
