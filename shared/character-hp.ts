/**
 * System-uebergreifender HP-Zugriff auf Character.data.
 *
 * Pro Regelwerk wohnt HP an einer eigenen Stelle:
 *   htbah:  data.hp.{current,max}
 *   dnd:    data.combat.hp.{current,max}
 *   dsa5:   data.state.leCurrent (max ist derived via dsa5Derived)
 *
 * Die Battle-Token-Spalten battle_tokens.hp / hp_max sind nur fuer
 * NPC-Tokens (ohne characterId) noch authoritativ — fuer
 * Charakter-Tokens muss serverseitig durchgesynct werden, damit ein
 * Karten-Wechsel keinen HP-Reset bedeutet.
 */
import { dsa5Derived, type Dsa5CharacterData } from './engines/dsa5'

export type CharSystem = 'dnd5e' | 'dnd2024' | 'dsa5' | 'dsa41' | 'htbah'

export interface CharacterHp {
  current: number | null
  max: number | null
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

function asNumOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function readCharacterHp(system: CharSystem, data: unknown): CharacterHp {
  const d = asObj(data)
  if (system === 'htbah') {
    const hp = asObj(d.hp)
    return { current: asNumOrNull(hp.current), max: asNumOrNull(hp.max) }
  }
  if (system === 'dnd5e' || system === 'dnd2024') {
    const combat = asObj(d.combat)
    const hp = asObj(combat.hp)
    return { current: asNumOrNull(hp.current), max: asNumOrNull(hp.max) }
  }
  if (system === 'dsa5') {
    const state = asObj(d.state)
    let max: number | null = null
    try {
      max = dsa5Derived(d as unknown as Dsa5CharacterData).lep
      if (!Number.isFinite(max)) max = null
    } catch {
      max = null
    }
    return { current: asNumOrNull(state.leCurrent), max }
  }
  // dsa41 ist heute UI-seitig nicht voll integriert — keine kanonische HP-Stelle.
  return { current: null, max: null }
}

/**
 * Liefert eine NEUE data-Kopie mit gepatchtem HP-Wert. Mutiert nichts in-place.
 * Bei DSA 5 wird `hpMax` ignoriert (max ist immer derived aus leBase/leMod/KO).
 */
export function writeCharacterHp(
  system: CharSystem,
  data: unknown,
  patch: { current?: number | null; max?: number | null },
): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(asObj(data))) as Record<string, unknown>
  if (system === 'htbah') {
    const hp = asObj(next.hp)
    if (patch.current !== undefined) hp.current = patch.current ?? 0
    if (patch.max !== undefined) hp.max = patch.max ?? 0
    next.hp = hp
    return next
  }
  if (system === 'dnd5e' || system === 'dnd2024') {
    const combat = asObj(next.combat)
    const hp = asObj(combat.hp)
    if (patch.current !== undefined) hp.current = patch.current ?? 0
    if (patch.max !== undefined) hp.max = patch.max ?? 0
    combat.hp = hp
    next.combat = combat
    return next
  }
  if (system === 'dsa5') {
    const state = asObj(next.state)
    if (patch.current !== undefined) state.leCurrent = patch.current ?? 0
    next.state = state
    // hpMax ignorieren — wird aus leBase + 2*KO + leMod berechnet.
    return next
  }
  return next
}
