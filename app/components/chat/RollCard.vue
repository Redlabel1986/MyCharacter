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
}

const props = defineProps<{ payload: RollPayload; mine: boolean }>()

const tone = computed(() => {
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
    default:
      return ''
  }
})

const headlineText = computed(() => {
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
      <div>
        Wurf:
        <span class="font-mono font-semibold">{{ formattedDice }}</span>
        <template v-if="payload.modifier"> + Mod {{ payload.modifier > 0 ? '+' : '' }}{{ payload.modifier }}</template>
        gegen
        <span class="font-mono font-semibold">{{ payload.target }}</span>
        <template v-if="payload.characterName"> · {{ payload.characterName }}</template>
      </div>
      <div v-if="qualityLabel">
        {{ qualityLabel }}<template v-if="margin !== null"> · um {{ margin }} unterboten</template>
      </div>
      <div v-if="payload.note" class="italic opacity-90">„{{ payload.note }}"</div>
    </div>
  </div>
</template>
