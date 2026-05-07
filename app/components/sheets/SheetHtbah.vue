<script setup lang="ts">
import {
  HTBAH_TALENTS,
  HTBAH_TALENT_LABELS,
  htbahCapForLevel,
  htbahSkillTotal,
  htbahDefaultInsightMax,
  htbahCalcSpentPoints,
  createBlankHtbah,
  type HtbahCharacterData,
  type HtbahTalent,
  type HtbahSkill,
} from '~~/shared/engines/htbah'
import type { GameSystem } from '~~/shared/systems'
import SheetSection from '~/components/ui/SheetSection.vue'
import StatBlock from '~/components/ui/StatBlock.vue'

const props = defineProps<{ data: Record<string, unknown>; system: GameSystem }>()
const emit = defineEmits<{ (e: 'update:data', v: Record<string, unknown>): void }>()

// Mit Blank mergen — schützt alte Charaktere vor fehlenden Feldern (talents, pointsPool, etc.).
const sheet = computed<HtbahCharacterData>(() => {
  const blank = createBlankHtbah('')
  const incoming = (props.data ?? {}) as Partial<HtbahCharacterData>
  return {
    ...blank,
    ...incoming,
    identity: { ...blank.identity, ...(incoming.identity ?? {}) },
    hp: { ...blank.hp, ...(incoming.hp ?? {}) },
    pointsPool: { ...blank.pointsPool, ...(incoming.pointsPool ?? {}) },
    talents: {
      handeln: { ...blank.talents.handeln, ...(incoming.talents?.handeln ?? {}) },
      wissen: { ...blank.talents.wissen, ...(incoming.talents?.wissen ?? {}) },
      soziales: { ...blank.talents.soziales, ...(incoming.talents?.soziales ?? {}) },
    },
    skills: incoming.skills ?? [],
  }
})

const update = (n: HtbahCharacterData) =>
  emit('update:data', n as unknown as Record<string, unknown>)
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
const setPool = <K extends keyof HtbahCharacterData['pointsPool']>(k: K, v: number) => {
  const n = clone(); n.pointsPool[k] = v; update(n)
}

const setTalentValue = (t: HtbahTalent, v: number) => {
  const n = clone()
  const oldExpected = htbahDefaultInsightMax(sheet.value.talents[t].value)
  n.talents[t].value = v
  // Wenn insightMax noch dem alten Standard entsprach, mit dem neuen Standard ersetzen
  if (n.talents[t].insightMax === oldExpected) {
    n.talents[t].insightMax = htbahDefaultInsightMax(v)
  }
  update(n)
}
const setTalentInsight = (t: HtbahTalent, k: 'insightCurrent' | 'insightMax', v: number) => {
  const n = clone(); n.talents[t][k] = v; update(n)
}
const autoFillInsight = (t: HtbahTalent) => {
  const n = clone()
  const max = htbahDefaultInsightMax(n.talents[t].value)
  n.talents[t].insightMax = max
  n.talents[t].insightCurrent = max
  update(n)
}

const setText = <K extends 'inventory' | 'notes' | 'beute'>(k: K, v: string) => {
  const n = clone(); n[k] = v; update(n)
}

const addSkill = (talent: HtbahTalent) => {
  const n = clone()
  n.skills.push({ id: crypto.randomUUID(), name: '', talent, spentPoints: 0 })
  update(n)
}
const updateSkill = (idx: number, patch: Partial<HtbahSkill>) => {
  const n = clone(); n.skills[idx] = { ...n.skills[idx], ...patch }; update(n)
}
const removeSkill = (idx: number) => { const n = clone(); n.skills.splice(idx, 1); update(n) }

const recalcSpent = () => {
  const n = clone()
  n.pointsPool.spent = htbahCalcSpentPoints(n)
  update(n)
}

const skillsByTalent = computed(() => {
  const map: Record<HtbahTalent, Array<{ idx: number; skill: HtbahSkill }>> = {
    handeln: [], wissen: [], soziales: [],
  }
  sheet.value.skills.forEach((skill, idx) => {
    if (map[skill.talent]) map[skill.talent].push({ idx, skill })
  })
  return map
})

const remainingPoints = computed(
  () => sheet.value.pointsPool.total - sheet.value.pointsPool.spent,
)
</script>

<template>
  <div class="grid lg:grid-cols-3 gap-5">
    <SheetSection title="Held*in" class="lg:col-span-2">
      <div class="grid sm:grid-cols-3 gap-3">
        <UFormField label="Geschlecht"><UInput :model-value="sheet.identity.sex" @update:model-value="setIdentity('sex', String($event))" /></UFormField>
        <UFormField label="Alter"><UInput :model-value="sheet.identity.age" @update:model-value="setIdentity('age', String($event))" /></UFormField>
        <UFormField label="Statur"><UInput :model-value="sheet.identity.height" @update:model-value="setIdentity('height', String($event))" /></UFormField>
        <UFormField label="Religion"><UInput :model-value="sheet.identity.religion" @update:model-value="setIdentity('religion', String($event))" /></UFormField>
        <UFormField label="Beruf"><UInput :model-value="sheet.identity.occupation" @update:model-value="setIdentity('occupation', String($event))" /></UFormField>
        <UFormField label="Familienstand"><UInput :model-value="sheet.identity.maritalStatus" @update:model-value="setIdentity('maritalStatus', String($event))" /></UFormField>
        <UFormField label="Aussehen" class="sm:col-span-3"><UInput :model-value="sheet.identity.appearance" @update:model-value="setIdentity('appearance', String($event))" /></UFormField>
        <UFormField label="Stimme"><UInput :model-value="sheet.identity.voice" @update:model-value="setIdentity('voice', String($event))" /></UFormField>
        <UFormField label="Kleidung"><UInput :model-value="sheet.identity.clothing" @update:model-value="setIdentity('clothing', String($event))" /></UFormField>
        <UFormField label="Vorlieben"><UInput :model-value="sheet.identity.likes" @update:model-value="setIdentity('likes', String($event))" /></UFormField>
        <UFormField label="Vorteile"><UTextarea rows="3" :model-value="sheet.identity.advantages" class="w-full" @update:model-value="setIdentity('advantages', String($event))" /></UFormField>
        <UFormField label="Nachteile"><UTextarea rows="3" :model-value="sheet.identity.disadvantages" class="w-full" @update:model-value="setIdentity('disadvantages', String($event))" /></UFormField>
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

      <div class="accent-rule my-3" />
      <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">Punkte-Pool</div>
      <div class="grid grid-cols-3 gap-2">
        <UFormField label="Gesamt"><UInput type="number" :model-value="sheet.pointsPool.total" @update:model-value="setPool('total', Number($event))" /></UFormField>
        <UFormField label="Verbraucht"><UInput type="number" :model-value="sheet.pointsPool.spent" @update:model-value="setPool('spent', Number($event))" /></UFormField>
        <StatBlock label="Übrig" :value="remainingPoints" />
      </div>
      <UButton size="xs" variant="ghost" class="mt-2" @click="recalcSpent">
        Aus Skills + Begabungen neu berechnen
      </UButton>
    </SheetSection>

    <SheetSection
      v-for="talent in HTBAH_TALENTS"
      :key="talent"
      :title="HTBAH_TALENT_LABELS[talent]"
      class="lg:col-span-1"
    >
      <div class="grid grid-cols-2 gap-3 items-end">
        <UFormField label="Grundwert">
          <UInput
            type="number"
            :model-value="sheet.talents[talent].value"
            @update:model-value="setTalentValue(talent, Number($event))"
          />
        </UFormField>
        <div class="stat-block px-2 py-1 text-center">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">Gedankenblitze</div>
          <div class="font-serif text-2xl">
            {{ sheet.talents[talent].insightCurrent }}/{{ sheet.talents[talent].insightMax }}
          </div>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2 mt-2">
        <UFormField label="GB aktuell">
          <UInput
            type="number"
            :model-value="sheet.talents[talent].insightCurrent"
            @update:model-value="setTalentInsight(talent, 'insightCurrent', Number($event))"
          />
        </UFormField>
        <UFormField label="GB max">
          <UInput
            type="number"
            :model-value="sheet.talents[talent].insightMax"
            @update:model-value="setTalentInsight(talent, 'insightMax', Number($event))"
          />
        </UFormField>
      </div>
      <UButton size="xs" variant="ghost" class="mt-2" @click="autoFillInsight(talent)">
        Auto: {{ htbahDefaultInsightMax(sheet.talents[talent].value) }} GB
      </UButton>

      <div class="accent-rule my-3" />
      <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">Fähigkeiten</div>
      <div class="hidden sm:grid grid-cols-12 gap-1 text-[10px] text-ink-300 px-1 mb-1">
        <div class="col-span-6">Name</div>
        <div class="col-span-2 text-center">Punkte</div>
        <div class="col-span-1 text-center">Grund</div>
        <div class="col-span-2 text-center">Total</div>
        <div class="col-span-1"></div>
      </div>
      <div class="space-y-1">
        <div
          v-for="entry in skillsByTalent[talent]"
          :key="entry.skill.id"
          class="grid grid-cols-12 gap-1 items-center"
        >
          <UInput
            class="col-span-6"
            :model-value="entry.skill.name"
            placeholder="Name"
            @update:model-value="updateSkill(entry.idx, { name: String($event) })"
          />
          <UInput
            type="number"
            class="col-span-2"
            :model-value="entry.skill.spentPoints"
            @update:model-value="updateSkill(entry.idx, { spentPoints: Number($event) })"
          />
          <div class="col-span-1 text-center text-sm text-ink-400">
            {{ sheet.talents[talent].value }}
          </div>
          <div class="col-span-2 text-center font-serif text-base">
            {{ htbahSkillTotal(sheet, entry.skill) }}
          </div>
          <UButton
            size="xs"
            color="error"
            variant="ghost"
            icon="i-lucide-x"
            class="col-span-1"
            @click="removeSkill(entry.idx)"
          />
        </div>
      </div>
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" class="mt-2" @click="addSkill(talent)">
        Fähigkeit
      </UButton>
    </SheetSection>

    <SheetSection title="Inventar & Beute" class="lg:col-span-2">
      <UFormField label="Inventar">
        <UTextarea
          rows="6"
          :model-value="sheet.inventory"
          class="w-full"
          @update:model-value="setText('inventory', String($event))"
        />
      </UFormField>
      <UFormField label="Beute / Münzen" class="mt-2">
        <UTextarea
          rows="3"
          placeholder="z.B. 0 Kupfer, 30 Silber, 53 Gold"
          :model-value="sheet.beute"
          class="w-full"
          @update:model-value="setText('beute', String($event))"
        />
      </UFormField>
    </SheetSection>

    <SheetSection title="Anmerkungen">
      <UTextarea
        rows="11"
        placeholder="Kontakte, Hintergrund, sonstiges…"
        :model-value="sheet.notes"
        class="w-full"
        @update:model-value="setText('notes', String($event))"
      />
    </SheetSection>
  </div>
</template>
