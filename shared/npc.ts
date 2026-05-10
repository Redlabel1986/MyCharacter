/**
 * NPC-Faehigkeiten an einem Battle-Token (ohne gekoppelten Charakter).
 * Discriminated Union pro Regelwerk — die Wurfformel haengt am `system`.
 *
 *   htbah: 1W100 <= value (Skill-Probe-Mechanik)
 *   dnd:   1W20 + mod (mit Vorteil/Nachteil und DC am Wurf-Panel)
 *   dsa5:  3W20 vs (probe-Eigenschaften + abilityValues + FW)
 */
import type { DsaAbility } from './engines/dsa5'

export type NpcAbilitySystem = 'htbah' | 'dnd' | 'dsa5'

export interface NpcAbilityHtbah {
  id: string
  system: 'htbah'
  label: string
  /** Zielwert (Talent + Skill-Bonus, vorgerechnet). 1W100 <= value = Erfolg. */
  value: number
}

export interface NpcAbilityDnd {
  id: string
  system: 'dnd'
  label: string
  /** Modifier auf 1W20. */
  mod: number
}

export interface NpcAbilityDsa5 {
  id: string
  system: 'dsa5'
  label: string
  /** Drei Eigenschaften, die fuer die Probe gewuerfelt werden. */
  probe: [DsaAbility, DsaAbility, DsaAbility]
  /** Eigenschaftswerte zu probe[0..2] — vorgerechnet, damit kein voller Charakterbogen noetig ist. */
  abilityValues: [number, number, number]
  /** Fertigkeits-/Zauber-/Liturgiewert. */
  fw: number
}

export type NpcAbility = NpcAbilityHtbah | NpcAbilityDnd | NpcAbilityDsa5
