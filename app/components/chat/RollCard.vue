<script setup lang="ts">
/**
 * Roll-Karte im Group-Chat. Zeigt das Wurfergebnis kompakt mit Farbe + Icon
 * an, je nachdem ob Erfolg/Misserfolg/Krit/Patzer.
 */
interface RollPayload {
  system: 'dnd5e' | 'dnd2024' | 'dsa5' | 'dsa41' | 'htbah'
  label: string
  characterId?: number
  characterName?: string
  target: number
  modifier?: number
  dice: number[]
  success: boolean
  critical?: boolean
  fumble?: boolean
  qualityStep?: number
  note?: string
  /** Wunden-Malus, der serverseitig auf den Wurf angewandt wurde (negativ). */
  damageMalus?: number
  /** Schadensstufe (0..3) zur Zeit des Wurfs. */
  damageLevel?: number
  /** Bei Schadens-Wurf gegen Ziel: Snapshot des Ziel-Namens. */
  targetName?: string
  /** Bei Schadens-Wurf: Rüstungsschutz des Ziels (HtbaH). 0 bei keiner Rüstung. */
  targetArmor?: number
  /** Bei Schadens-Wurf: tatsächlicher Schaden nach Rüstung. */
  finalDamage?: number
  /** Bei freiem Wurf mit Ziel: 'damage' oder 'heal'. */
  damageKind?: 'damage' | 'heal'
  /** Marker fuer freie NdM±X-Wuerfe (Schaden/Heilung/Misc). */
  freeRoll?: boolean
  /** Stumpfwaffen-Reroll (Server-seitig): jeder 1er einmal neu gewuerfelt. */
  schlagwaffeRerolls?: Array<{ index: number; from: number; to: number }>
  /** Ruestungsbrechend X — Reduktion der Ziel-RW. */
  armorBreak?: number
  /** Anzeige der Waffen-Kategorie ("stumpf"/"hieb"/"stich"/…). */
  weaponCategory?: 'stumpf' | 'hieb' | 'stich' | 'fernkampf' | 'wurf' | 'sonstige'
  /** Probe wurde mit "Aufspießen"-Eigenschaft gewuerfelt (Krit-Bereich x2). */
  aufspiessen?: boolean
  /** Jagdwaffen-Bonus +15 auf den Trefferwurf (bereits in target eingerechnet). */
  huntingBonus?: number
}

const props = defineProps<{ payload: RollPayload; mine: boolean }>()

const tone = computed(() => {
  if (props.payload.freeRoll) return 'free'
  if (props.payload.fumble) return 'fumble'
  if (props.payload.critical) return 'critical'
  if (props.payload.success) return 'success'
  return 'failure'
})

const toneClass = computed(() => {
  switch (tone.value) {
    case 'fumble':
      return 'bg-red-700 text-white border-red-900'
    case 'critical':
      return 'bg-emerald-600 text-white border-emerald-800'
    case 'success':
      return 'bg-emerald-100 text-emerald-900 border-emerald-300'
    case 'failure':
      return 'bg-amber-100 text-amber-900 border-amber-300'
    case 'free':
      return 'bg-sky-100 text-sky-900 border-sky-300'
    default:
      return ''
  }
})

const iconName = computed(() => {
  switch (tone.value) {
    case 'fumble':
      return 'i-lucide-skull'
    case 'critical':
      return 'i-lucide-sparkles'
    case 'success':
      return 'i-lucide-check'
    case 'failure':
      return 'i-lucide-x'
    case 'free':
      return 'i-lucide-dices'
    default:
      return ''
  }
})

const headlineText = computed(() => {
  if (props.payload.freeRoll) return 'Wurf'
  if (props.payload.fumble) return 'Kritischer Patzer'
  if (props.payload.critical) return 'Kritischer Erfolg'
  if (props.payload.success) return 'Erfolg'
  return 'Misserfolg'
})

const margin = computed(() => {
  if (!props.payload.success) return null
  // HtbaH: dice ist [roll], target ist Zielwert (Skill-Total + ggf. Mod).
  // Bei Roll-unter-System: Marge = target - roll.
  if (props.payload.system === 'htbah' && props.payload.dice[0] !== undefined) {
    return props.payload.target - props.payload.dice[0]
  }
  return null
})

const qualityLabel = computed(() => {
  const s = props.payload.qualityStep
  if (!s) return null
  return s >= 7 ? 'Maximaler Erfolg' : `Qualitätsstufe ${s}`
})

const formattedDice = computed(() => props.payload.dice.join(', '))

// Freie Wuerfe (Schaden/Heilung) zeigen die Wuerfel mit " + " verkettet,
// damit der Spieler die Summe direkt nachvollziehen kann.
const freeDiceSum = computed(() =>
  props.payload.dice.reduce((a: number, b: number) => a + b, 0),
)
const freeDiceFormula = computed(() => props.payload.dice.join(' + '))

// Ist das ein Schaden-Wurf gegen ein Ziel mit ausgewerteter Rüstung?
// Wird auch dann als true angesehen, wenn die Rüstung 0 ist — wir wollen
// "− Rüstung 0" trotzdem zeigen, damit klar ist: hier wurde berücksichtigt.
const hasArmorBreakdown = computed(
  () => props.payload.freeRoll
    && props.payload.damageKind !== 'heal'
    && typeof props.payload.targetArmor === 'number'
    && typeof props.payload.finalDamage === 'number',
)
// Heilung gegen ein Ziel: Wurfsumme wird voll dem Ziel zugefuehrt (keine
// Ruestung). Wir zeigen einen Hinweis "<Ziel> wird um <Summe> geheilt".
const hasHealBreakdown = computed(
  () => props.payload.freeRoll
    && props.payload.damageKind === 'heal'
    && !!props.payload.targetName,
)
</script>

<template>
  <div
    class="max-w-[90%] px-3 py-2 rounded-lg border text-sm shadow-sm"
    :class="toneClass"
  >
    <div class="flex items-center gap-2 mb-1">
      <UIcon v-if="iconName" :name="iconName" class="text-lg" />
      <span class="font-semibold">{{ headlineText }}</span>
      <span class="text-xs opacity-80">·</span>
      <span class="text-xs opacity-90">{{ payload.label }}</span>
    </div>
    <div class="text-xs opacity-90 space-y-0.5">
      <!-- Freier Wurf (Schaden/Heilung/Misc): Wuerfel mit „+" verkettet, Summe
           explizit, danach ggf. Ruestungs-Breakdown bei Schaden gegen Ziel.
           Sonderfall ohne Wuerfel (fixe Effekte wie Heiltrank): zeigt nur
           „Effekt: N", ohne den Wurf-Prefix. -->
      <div v-if="payload.freeRoll">
        <template v-if="payload.dice.length === 0">
          Effekt: <span class="font-mono font-semibold">{{ payload.target }}</span>
        </template>
        <template v-else>
          Wurf:
          <span class="font-mono font-semibold">{{ freeDiceFormula }}</span>
          <template v-if="payload.dice.length > 1">
            = <span class="font-mono font-semibold">{{ freeDiceSum }}</span>
          </template>
          <template v-if="payload.modifier">
            + Mod {{ payload.modifier > 0 ? '+' : '' }}{{ payload.modifier }}
            = <span class="font-mono font-semibold">{{ payload.target }}</span>
          </template>
          <template v-else-if="payload.dice.length === 1">
            = <span class="font-mono font-semibold">{{ payload.target }}</span>
          </template>
        </template>
        <template v-if="payload.characterName"> · {{ payload.characterName }}</template>
      </div>
      <!-- Klassischer Probenwurf (Skill/Save/Ability/etc.) -->
      <div v-else>
        Wurf:
        <span class="font-mono font-semibold">{{ formattedDice }}</span>
        <template v-if="payload.modifier"> + Mod {{ payload.modifier > 0 ? '+' : '' }}{{ payload.modifier }}</template>
        <template v-if="payload.damageMalus"> · Wunden {{ payload.damageMalus }}</template>
        gegen
        <span class="font-mono font-semibold">{{ payload.target }}</span>
        <template v-if="payload.characterName"> · {{ payload.characterName }}</template>
      </div>
      <!-- Schadens-Anrechnung gegen Ziel mit Ruestung -->
      <div v-if="hasArmorBreakdown" class="font-semibold">
        <span class="font-mono">{{ payload.target }}</span>
        <template v-if="(payload.targetArmor ?? 0) > 0">
          − Rüstung <span class="font-mono">{{ payload.targetArmor }}</span>
          <template v-if="(payload.armorBreak ?? 0) > 0">
            (Rüstungsbrechend −{{ payload.armorBreak }})
          </template>
          = <span class="font-mono">{{ payload.finalDamage }}</span> Schaden
        </template>
        <template v-else-if="(payload.armorBreak ?? 0) > 0">
          (Rüstungsbrechend −{{ payload.armorBreak }} negiert die RW komplett) Schaden
        </template>
        <template v-else>
          Schaden (Ziel ohne Rüstung)
        </template>
        <template v-if="payload.targetName"> an {{ payload.targetName }}</template>
      </div>
      <!-- Stumpfwaffen-Reroll (1er → neuer Wert) — transparent dargestellt -->
      <div
        v-if="payload.schlagwaffeRerolls && payload.schlagwaffeRerolls.length"
        class="text-[10px] opacity-80"
      >
        🔨 Schlagwaffe-Reroll:
        <template
          v-for="(r, i) in payload.schlagwaffeRerolls"
          :key="i"
        >
          <span class="font-mono">{{ r.from }}→{{ r.to }}</span><template v-if="i < payload.schlagwaffeRerolls.length - 1">, </template>
        </template>
      </div>
      <!-- Jagdwaffen-Bonus / Aufspießen-Hinweis im Probenwurf -->
      <div
        v-if="payload.huntingBonus && payload.huntingBonus > 0"
        class="text-[10px] font-semibold opacity-80"
      >
        🎯 Jagdwaffe +{{ payload.huntingBonus }} (Ziel hat niedrige Rüstung)
      </div>
      <div
        v-if="payload.aufspiessen"
        class="text-[10px] font-semibold opacity-80"
      >
        🗡 Aufspießen — Krit-Bereich verdoppelt (Krit beschädigt Rüstung um −1 RW dauerhaft)
      </div>
      <!-- Heilung gegen Ziel: voller Wurf wird zugefuehrt. -->
      <div v-if="hasHealBreakdown" class="font-semibold">
        {{ payload.targetName }} wird um
        <span class="font-mono">{{ payload.target }}</span>
        geheilt
      </div>
      <div v-if="qualityLabel">
        {{ qualityLabel }}<template v-if="margin !== null"> · um {{ margin }} unterboten</template>
      </div>
      <div
        v-if="payload.damageMalus"
        class="text-[10px] font-semibold uppercase tracking-widest opacity-80"
      >
        🩸 Schadensstufe {{ payload.damageLevel }} · {{ payload.damageMalus }} auf den Wurf
      </div>
      <div v-if="payload.note" class="italic opacity-90">„{{ payload.note }}"</div>
    </div>
  </div>
</template>
