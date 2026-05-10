<script setup lang="ts">
/**
 * Editor fuer NPC-Faehigkeiten am Token (DM-Stat-Block).
 * Eingabefelder pro Zeile haengen am gewaehlten Regelwerk.
 */
import type { NpcAbility } from '~~/shared/npc'
import { DSA_ABILITIES, DSA_ABILITY_LABELS, type DsaAbility } from '~~/shared/engines/dsa5'

type NpcSystem = 'htbah' | 'dnd' | 'dsa5' | null

const props = defineProps<{
  system: NpcSystem
  abilities: NpcAbility[]
}>()

const emit = defineEmits<{
  (e: 'update:system', v: NpcSystem): void
  (e: 'update:abilities', v: NpcAbility[]): void
}>()

const SYSTEM_OPTIONS = [
  { label: '— kein Wuerfler —', value: null as NpcSystem },
  { label: 'How to be a Hero (1W100)', value: 'htbah' as NpcSystem },
  { label: 'D&D 5e/2024 (1W20+Mod)', value: 'dnd' as NpcSystem },
  { label: 'DSA 5 (3W20)', value: 'dsa5' as NpcSystem },
]
const DSA_OPTIONS = DSA_ABILITIES.map((a) => ({
  label: `${a} — ${DSA_ABILITY_LABELS[a]}`,
  value: a as DsaAbility,
}))

const newId = () => Math.random().toString(36).slice(2, 10)

function onSystemInput(v: NpcSystem) {
  emit('update:system', v)
  // Bei Wechsel anders typisierte Eintraege verwerfen.
  emit(
    'update:abilities',
    v ? props.abilities.filter((a) => a.system === v) : [],
  )
}

function blank(sys: 'htbah' | 'dnd' | 'dsa5'): NpcAbility {
  if (sys === 'htbah') return { id: newId(), system: 'htbah', label: '', value: 50 }
  if (sys === 'dnd') return { id: newId(), system: 'dnd', label: '', mod: 0 }
  return {
    id: newId(),
    system: 'dsa5',
    label: '',
    probe: ['MU', 'KL', 'IN'],
    abilityValues: [10, 10, 10],
    fw: 0,
  }
}

function add() {
  if (!props.system) return
  emit('update:abilities', [...props.abilities, blank(props.system)])
}

function remove(id: string) {
  emit('update:abilities', props.abilities.filter((a) => a.id !== id))
}

// Inplace-Mutationen einer Faehigkeit; danach Array-Identitaet refreshen.
function patched() {
  emit('update:abilities', [...props.abilities])
}
</script>

<template>
  <div class="space-y-3">
    <UFormField label="NPC-Wuerfler-Regelwerk" help="Bestimmt die Wurfformel fuer alle Faehigkeiten dieses Tokens.">
      <USelect
        :model-value="system"
        :items="SYSTEM_OPTIONS"
        value-key="value"
        class="w-full"
        @update:model-value="onSystemInput"
      />
    </UFormField>

    <div v-if="system" class="space-y-2">
      <div class="flex items-center justify-between">
        <div class="text-xs uppercase tracking-widest text-ink-300">Faehigkeiten</div>
        <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="add">
          Hinzufuegen
        </UButton>
      </div>

      <p v-if="!abilities.length" class="text-xs text-ink-300 italic">
        Noch keine Faehigkeit. Klick auf „Hinzufuegen", um eine Probe einzutragen.
      </p>

      <!-- HtbaH-Zeile: Label + Zielwert (1-100) -->
      <template v-if="system === 'htbah'">
        <div
          v-for="a in (abilities as Extract<NpcAbility, { system: 'htbah' }>[])"
          :key="a.id"
          class="grid grid-cols-12 gap-2 items-center"
        >
          <UInput
            v-model="a.label"
            class="col-span-7"
            placeholder="z.B. Wahrnehmung"
            :maxlength="60"
            @update:model-value="patched"
          />
          <UInput
            v-model.number="a.value"
            class="col-span-3"
            type="number"
            min="0"
            max="100"
            placeholder="Zielwert"
            @update:model-value="patched"
          />
          <UButton
            class="col-span-2"
            size="xs"
            variant="ghost"
            color="error"
            icon="i-lucide-x"
            @click="remove(a.id)"
          />
        </div>
      </template>

      <!-- D&D-Zeile: Label + Mod -->
      <template v-if="system === 'dnd'">
        <div
          v-for="a in (abilities as Extract<NpcAbility, { system: 'dnd' }>[])"
          :key="a.id"
          class="grid grid-cols-12 gap-2 items-center"
        >
          <UInput
            v-model="a.label"
            class="col-span-7"
            placeholder="z.B. Stealth"
            :maxlength="60"
            @update:model-value="patched"
          />
          <UInput
            v-model.number="a.mod"
            class="col-span-3"
            type="number"
            min="-30"
            max="30"
            placeholder="Mod"
            @update:model-value="patched"
          />
          <UButton
            class="col-span-2"
            size="xs"
            variant="ghost"
            color="error"
            icon="i-lucide-x"
            @click="remove(a.id)"
          />
        </div>
      </template>

      <!-- DSA-5-Zeile: Label + Probe-Tripel + Eigenschaftswerte + FW -->
      <template v-if="system === 'dsa5'">
        <div
          v-for="a in (abilities as Extract<NpcAbility, { system: 'dsa5' }>[])"
          :key="a.id"
          class="space-y-1 border-t border-parchment-700/20 pt-2"
        >
          <div class="grid grid-cols-12 gap-2 items-center">
            <UInput
              v-model="a.label"
              class="col-span-9"
              placeholder="z.B. Schleichen"
              :maxlength="60"
              @update:model-value="patched"
            />
            <UInput
              v-model.number="a.fw"
              class="col-span-2"
              type="number"
              min="0"
              max="25"
              placeholder="FW"
              @update:model-value="patched"
            />
            <UButton
              class="col-span-1"
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-x"
              @click="remove(a.id)"
            />
          </div>
          <div class="grid grid-cols-6 gap-2 items-center">
            <USelect
              v-model="a.probe[0]"
              :items="DSA_OPTIONS"
              value-key="value"
              size="xs"
              @update:model-value="patched"
            />
            <UInput
              v-model.number="a.abilityValues[0]"
              type="number"
              min="0"
              max="30"
              size="xs"
              @update:model-value="patched"
            />
            <USelect
              v-model="a.probe[1]"
              :items="DSA_OPTIONS"
              value-key="value"
              size="xs"
              @update:model-value="patched"
            />
            <UInput
              v-model.number="a.abilityValues[1]"
              type="number"
              min="0"
              max="30"
              size="xs"
              @update:model-value="patched"
            />
            <USelect
              v-model="a.probe[2]"
              :items="DSA_OPTIONS"
              value-key="value"
              size="xs"
              @update:model-value="patched"
            />
            <UInput
              v-model.number="a.abilityValues[2]"
              type="number"
              min="0"
              max="30"
              size="xs"
              @update:model-value="patched"
            />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
