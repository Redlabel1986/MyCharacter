<script setup lang="ts">
import {
  HTBAH_TALENTS,
  HTBAH_TALENT_LABELS,
  htbahCapForLevel,
  htbahTalentScore,
  type HtbahCharacterData,
  type HtbahTalent,
} from '~~/shared/engines/htbah'
import type { GameSystem } from '~~/shared/systems'
import SheetSection from '~/components/ui/SheetSection.vue'
import StatBlock from '~/components/ui/StatBlock.vue'

const props = defineProps<{ data: Record<string, unknown>; system: GameSystem }>()
const emit = defineEmits<{ (e: 'update:data', v: Record<string, unknown>): void }>()

const sheet = computed<HtbahCharacterData>(() => props.data as HtbahCharacterData)
const update = (n: HtbahCharacterData) => emit('update:data', n as unknown as Record<string, unknown>)
const clone = () => JSON.parse(JSON.stringify(sheet.value)) as HtbahCharacterData

const setIdentity = <K extends keyof HtbahCharacterData['identity']>(k: K, v: string) => {
  const n = clone(); n.identity[k] = v; update(n)
}
const setLevel = (v: number) => {
  const n = clone()
  n.level = Math.max(1, v)
  n.skillCap = htbahCapForLevel(n.level)
  update(n)
}
const setHp = <K extends keyof HtbahCharacterData['hp']>(k: K, v: number) => {
  const n = clone(); n.hp[k] = v; update(n)
}
const setInspiration = (v: number) => { const n = clone(); n.inspiration = v; update(n) }
const setText = <K extends 'inventory' | 'notes'>(k: K, v: string) => {
  const n = clone(); n[k] = v; update(n)
}

const addSkill = (talent: HtbahTalent) => {
  const n = clone(); n.skills.push({ id: crypto.randomUUID(), name: '', talent, value: 10 }); update(n)
}
const updateSkill = (idx: number, patch: Partial<HtbahCharacterData['skills'][number]>) => {
  const n = clone(); n.skills[idx] = { ...n.skills[idx], ...patch }; update(n)
}
const removeSkill = (idx: number) => { const n = clone(); n.skills.splice(idx, 1); update(n) }

const skillsByTalent = computed(() => {
  const map: Record<HtbahTalent, Array<{ idx: number; skill: HtbahCharacterData['skills'][number] }>> = {
    handeln: [], wissen: [], soziales: [],
  }
  sheet.value.skills.forEach((skill, idx) => {
    map[skill.talent].push({ idx, skill })
  })
  return map
})
</script>

<template>
  <div class="grid lg:grid-cols-3 gap-5">
    <SheetSection title="Held*in" class="lg:col-span-2">
      <div class="grid sm:grid-cols-3 gap-3">
        <UFormField label="Geschlecht"><UInput :model-value="sheet.identity.sex" @update:model-value="setIdentity('sex', String($event))" /></UFormField>
        <UFormField label="Alter"><UInput :model-value="sheet.identity.age" @update:model-value="setIdentity('age', String($event))" /></UFormField>
        <UFormField label="Beruf / Hobbys"><UInput :model-value="sheet.identity.occupation" @update:model-value="setIdentity('occupation', String($event))" /></UFormField>
        <UFormField label="Aussehen" class="sm:col-span-2"><UInput :model-value="sheet.identity.appearance" @update:model-value="setIdentity('appearance', String($event))" /></UFormField>
        <UFormField label="Stimme"><UInput :model-value="sheet.identity.voice" @update:model-value="setIdentity('voice', String($event))" /></UFormField>
        <UFormField label="Kleidung"><UInput :model-value="sheet.identity.clothing" @update:model-value="setIdentity('clothing', String($event))" /></UFormField>
        <UFormField label="Vorlieben" class="sm:col-span-2"><UInput :model-value="sheet.identity.likes" @update:model-value="setIdentity('likes', String($event))" /></UFormField>
        <UFormField label="Vorteile"><UTextarea rows="3" :model-value="sheet.identity.advantages" @update:model-value="setIdentity('advantages', String($event))" /></UFormField>
        <UFormField label="Nachteile"><UTextarea rows="3" :model-value="sheet.identity.disadvantages" @update:model-value="setIdentity('disadvantages', String($event))" /></UFormField>
      </div>
    </SheetSection>

    <SheetSection title="Status">
      <div class="grid grid-cols-2 gap-2">
        <StatBlock label="Stufe" :value="sheet.level" />
        <StatBlock label="Skill-Cap" :value="sheet.skillCap" />
        <StatBlock label="LP" :value="`${sheet.hp.current}/${sheet.hp.max}`" />
        <StatBlock label="Inspiration" :value="sheet.inspiration" />
      </div>
      <div class="grid grid-cols-2 gap-2 mt-3">
        <UFormField label="Stufe"><UInput type="number" :model-value="sheet.level" @update:model-value="setLevel(Number($event))" /></UFormField>
        <UFormField label="LP aktuell"><UInput type="number" :model-value="sheet.hp.current" @update:model-value="setHp('current', Number($event))" /></UFormField>
        <UFormField label="LP max"><UInput type="number" :model-value="sheet.hp.max" @update:model-value="setHp('max', Number($event))" /></UFormField>
        <UFormField label="Inspiration"><UInput type="number" :model-value="sheet.inspiration" @update:model-value="setInspiration(Number($event))" /></UFormField>
      </div>
    </SheetSection>

    <SheetSection v-for="talent in HTBAH_TALENTS" :key="talent" :title="HTBAH_TALENT_LABELS[talent]" class="lg:col-span-1">
      <div class="flex items-baseline justify-between">
        <span class="text-xs uppercase tracking-widest text-ink-300">Begabungswert</span>
        <span class="font-serif text-3xl">{{ htbahTalentScore(sheet, talent) }}</span>
      </div>
      <div class="space-y-1 mt-3">
        <div v-for="entry in skillsByTalent[talent]" :key="entry.skill.id" class="grid grid-cols-12 gap-1 items-center">
          <UInput class="col-span-7" :model-value="entry.skill.name" @update:model-value="updateSkill(entry.idx, { name: String($event) })" />
          <UInput type="number" class="col-span-3" :model-value="entry.skill.value" @update:model-value="updateSkill(entry.idx, { value: Number($event) })" />
          <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" class="col-span-2" @click="removeSkill(entry.idx)" />
        </div>
      </div>
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" class="mt-2" @click="addSkill(talent)">
        Skill in {{ HTBAH_TALENT_LABELS[talent] }}
      </UButton>
    </SheetSection>

    <SheetSection title="Inventar & Notizen" class="lg:col-span-3">
      <UFormField label="Inventar"><UTextarea rows="5" :model-value="sheet.inventory" @update:model-value="setText('inventory', String($event))" /></UFormField>
      <UFormField label="Notizen" class="mt-2"><UTextarea rows="5" :model-value="sheet.notes" @update:model-value="setText('notes', String($event))" /></UFormField>
    </SheetSection>
  </div>
</template>
