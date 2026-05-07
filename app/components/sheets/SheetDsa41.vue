<script setup lang="ts">
import { DSA_ABILITIES, DSA_ABILITY_LABELS, type DsaAbility } from '~~/shared/engines/dsa5'
import { dsa41Derived, type Dsa41CharacterData } from '~~/shared/engines/dsa41'
import type { GameSystem } from '~~/shared/systems'
import SheetSection from '~/components/ui/SheetSection.vue'
import StatBlock from '~/components/ui/StatBlock.vue'

const props = defineProps<{ data: Record<string, unknown>; system: GameSystem }>()
const emit = defineEmits<{ (e: 'update:data', v: Record<string, unknown>): void }>()

const sheet = computed<Dsa41CharacterData>(() => props.data as Dsa41CharacterData)
const update = (next: Dsa41CharacterData) => emit('update:data', next as unknown as Record<string, unknown>)
const clone = () => JSON.parse(JSON.stringify(sheet.value)) as Dsa41CharacterData

const derived = computed(() => dsa41Derived(sheet.value))

const setIdentity = <K extends keyof Dsa41CharacterData['identity']>(k: K, v: Dsa41CharacterData['identity'][K]) => {
  const n = clone(); n.identity[k] = v; update(n)
}
const setAbility = (k: DsaAbility, v: number) => { const n = clone(); n.abilities[k] = Math.max(1, v); update(n) }
const setMod = <K extends keyof Dsa41CharacterData['derivedMod']>(k: K, v: number) => {
  const n = clone(); n.derivedMod[k] = v; update(n)
}
const setCombatMod = <K extends keyof Dsa41CharacterData['combatBaseMod']>(k: K, v: number) => {
  const n = clone(); n.combatBaseMod[k] = v; update(n)
}
const setText = <K extends 'advantages' | 'disadvantages' | 'specialAbilities' | 'inventory' | 'notes'>(k: K, v: string) => {
  const n = clone(); n[k] = v; update(n)
}

const addTalent = () => {
  const n = clone()
  n.talents.push({
    id: crypto.randomUUID(),
    name: '',
    group: 'Körperlich',
    probe: ['MU', 'MU', 'MU'],
    taw: 0,
    spalte: 'B',
    notes: '',
  })
  update(n)
}
const updateTalent = (idx: number, patch: Partial<Dsa41CharacterData['talents'][number]>) => {
  const n = clone(); n.talents[idx] = { ...n.talents[idx], ...patch }; update(n)
}
const removeTalent = (idx: number) => { const n = clone(); n.talents.splice(idx, 1); update(n) }

const talentGroups: Dsa41CharacterData['talents'][number]['group'][] = [
  'Kampf', 'Körperlich', 'Gesellschaftlich', 'Natur', 'Wissen', 'Sprachen', 'Handwerk', 'Gabe',
]
const experienceLevels: Dsa41CharacterData['identity']['experienceLevel'][] = [
  'Unerfahren', 'Durchschnittlich', 'Erfahren', 'Kompetent', 'Meisterlich', 'Brillant', 'Legendär',
]

const setSpellcaster = (v: boolean) => { const n = clone(); n.isSpellcaster = v; update(n) }
const setBlessed = (v: boolean) => { const n = clone(); n.isBlessed = v; update(n) }
</script>

<template>
  <div class="grid lg:grid-cols-3 gap-5">
    <SheetSection title="Stammdaten" class="lg:col-span-2">
      <div class="grid sm:grid-cols-3 gap-3">
        <UFormField label="Rasse"><UInput :model-value="sheet.identity.race" class="w-full" @update:model-value="setIdentity('race', String($event))" /></UFormField>
        <UFormField label="Kultur"><UInput :model-value="sheet.identity.culture" class="w-full" @update:model-value="setIdentity('culture', String($event))" /></UFormField>
        <UFormField label="Profession"><UInput :model-value="sheet.identity.profession" class="w-full" @update:model-value="setIdentity('profession', String($event))" /></UFormField>
        <UFormField label="Geschlecht"><UInput :model-value="sheet.identity.sex" class="w-full" @update:model-value="setIdentity('sex', String($event))" /></UFormField>
        <UFormField label="Alter"><UInput :model-value="sheet.identity.age" class="w-full" @update:model-value="setIdentity('age', String($event))" /></UFormField>
        <UFormField label="Geburtstag"><UInput :model-value="sheet.identity.birthday" class="w-full" @update:model-value="setIdentity('birthday', String($event))" /></UFormField>
        <UFormField label="Größe"><UInput :model-value="sheet.identity.height" class="w-full" @update:model-value="setIdentity('height', String($event))" /></UFormField>
        <UFormField label="Gewicht"><UInput :model-value="sheet.identity.weight" class="w-full" @update:model-value="setIdentity('weight', String($event))" /></UFormField>
        <UFormField label="Sozialstatus"><UInput :model-value="sheet.identity.socialStatus" class="w-full" @update:model-value="setIdentity('socialStatus', String($event))" /></UFormField>
        <UFormField label="Titel"><UInput :model-value="sheet.identity.title" class="w-full" @update:model-value="setIdentity('title', String($event))" /></UFormField>
        <UFormField label="Erfahrungsgrad">
          <USelect :model-value="sheet.identity.experienceLevel" :items="experienceLevels"
            @update:model-value="setIdentity('experienceLevel', $event as Dsa41CharacterData['identity']['experienceLevel'])" />
        </UFormField>
        <UFormField label="AP gesamt / eingesetzt">
          <div class="flex gap-2">
            <UInput type="number" :model-value="sheet.identity.apTotal" @update:model-value="setIdentity('apTotal', Number($event))" />
            <UInput type="number" :model-value="sheet.identity.apSpent" @update:model-value="setIdentity('apSpent', Number($event))" />
          </div>
        </UFormField>
      </div>
      <div class="flex gap-4 mt-4">
        <label class="flex items-center gap-2 text-sm">
          <UCheckbox :model-value="sheet.isSpellcaster" @update:model-value="setSpellcaster(!!$event)" />
          Magisch begabt (AsP)
        </label>
        <label class="flex items-center gap-2 text-sm">
          <UCheckbox :model-value="sheet.isBlessed" @update:model-value="setBlessed(!!$event)" />
          Geweiht (KaP)
        </label>
      </div>
    </SheetSection>

    <SheetSection title="Eigenschaften">
      <div class="grid grid-cols-4 gap-2">
        <div v-for="key in DSA_ABILITIES" :key="key" class="stat-block px-2 py-2 text-center">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">{{ DSA_ABILITY_LABELS[key] }}</div>
          <input type="number" class="parchment-input w-full text-center font-serif text-xl rounded mt-1"
            :value="sheet.abilities[key]"
            @input="setAbility(key, Number(($event.target as HTMLInputElement).value))">
          <div class="text-[10px] text-ink-300">{{ key }}</div>
        </div>
      </div>
    </SheetSection>

    <SheetSection title="Abgeleitete Werte" class="lg:col-span-3">
      <div class="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-10 gap-2">
        <StatBlock label="LeP" :value="`${sheet.state.lepCurrent}/${derived.lep}`" />
        <StatBlock label="AuP" :value="`${sheet.state.aupCurrent}/${derived.aup}`" />
        <StatBlock v-if="sheet.isSpellcaster" label="AsP" :value="`${sheet.state.aspCurrent}/${derived.asp}`" />
        <StatBlock v-if="sheet.isBlessed" label="KaP" :value="`${sheet.state.kapCurrent}/${derived.kap}`" />
        <StatBlock label="MR" :value="derived.mr" />
        <StatBlock label="INI" :value="derived.ini" />
        <StatBlock label="AT" :value="derived.at" />
        <StatBlock label="PA" :value="derived.pa" />
        <StatBlock label="FK" :value="derived.fk" />
        <StatBlock label="GS" :value="derived.gs" />
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
        <UFormField label="LeP-Mod"><UInput type="number" :model-value="sheet.derivedMod.lep" @update:model-value="setMod('lep', Number($event))" /></UFormField>
        <UFormField label="AuP-Mod"><UInput type="number" :model-value="sheet.derivedMod.aup" @update:model-value="setMod('aup', Number($event))" /></UFormField>
        <UFormField label="AsP-Mod"><UInput type="number" :model-value="sheet.derivedMod.asp" @update:model-value="setMod('asp', Number($event))" /></UFormField>
        <UFormField label="KaP-Mod"><UInput type="number" :model-value="sheet.derivedMod.kap" @update:model-value="setMod('kap', Number($event))" /></UFormField>
        <UFormField label="MR-Mod"><UInput type="number" :model-value="sheet.derivedMod.mr" @update:model-value="setMod('mr', Number($event))" /></UFormField>
        <UFormField label="INI-Mod"><UInput type="number" :model-value="sheet.derivedMod.ini" @update:model-value="setMod('ini', Number($event))" /></UFormField>
        <UFormField label="GS-Mod"><UInput type="number" :model-value="sheet.derivedMod.gs" @update:model-value="setMod('gs', Number($event))" /></UFormField>
        <UFormField label="AT-Mod"><UInput type="number" :model-value="sheet.combatBaseMod.at" @update:model-value="setCombatMod('at', Number($event))" /></UFormField>
        <UFormField label="PA-Mod"><UInput type="number" :model-value="sheet.combatBaseMod.pa" @update:model-value="setCombatMod('pa', Number($event))" /></UFormField>
        <UFormField label="FK-Mod"><UInput type="number" :model-value="sheet.combatBaseMod.fk" @update:model-value="setCombatMod('fk', Number($event))" /></UFormField>
      </div>
    </SheetSection>

    <SheetSection title="Talente" class="lg:col-span-3">
      <div v-for="(t, idx) in sheet.talents" :key="t.id" class="grid grid-cols-12 gap-2 items-end mb-2">
        <UFormField label="Name" class="col-span-3">
          <UInput :model-value="t.name" @update:model-value="updateTalent(idx, { name: String($event) })" />
        </UFormField>
        <UFormField label="Gruppe" class="col-span-2">
          <USelect :model-value="t.group" :items="talentGroups"
            @update:model-value="updateTalent(idx, { group: $event as Dsa41CharacterData['talents'][number]['group'] })" />
        </UFormField>
        <div class="col-span-3 grid grid-cols-3 gap-1">
          <USelect v-for="i in 3" :key="i" :model-value="t.probe[i-1]" :items="['-', ...DSA_ABILITIES]"
            @update:model-value="updateTalent(idx, { probe: t.probe.map((p, j) => j === i-1 ? ($event as DsaAbility | '-') : p) as Dsa41CharacterData['talents'][number]['probe'] })" />
        </div>
        <UFormField label="TaW" class="col-span-1">
          <UInput type="number" :model-value="t.taw" @update:model-value="updateTalent(idx, { taw: Number($event) })" />
        </UFormField>
        <UFormField label="Spalte" class="col-span-2">
          <USelect :model-value="t.spalte" :items="['A','B','C','D','E','F','G','H']"
            @update:model-value="updateTalent(idx, { spalte: $event as Dsa41CharacterData['talents'][number]['spalte'] })" />
        </UFormField>
        <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" class="col-span-1" @click="removeTalent(idx)" />
      </div>
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addTalent">Talent hinzufügen</UButton>
    </SheetSection>

    <SheetSection title="Vor-/Nachteile, SF" class="lg:col-span-2">
      <UFormField label="Vorteile"><UTextarea rows="3" :model-value="sheet.advantages" @update:model-value="setText('advantages', String($event))" /></UFormField>
      <UFormField label="Nachteile" class="mt-2"><UTextarea rows="3" :model-value="sheet.disadvantages" @update:model-value="setText('disadvantages', String($event))" /></UFormField>
      <UFormField label="Sonderfertigkeiten" class="mt-2"><UTextarea rows="4" :model-value="sheet.specialAbilities" @update:model-value="setText('specialAbilities', String($event))" /></UFormField>
    </SheetSection>

    <SheetSection title="Inventar & Notizen">
      <UFormField label="Inventar"><UTextarea rows="6" :model-value="sheet.inventory" @update:model-value="setText('inventory', String($event))" /></UFormField>
      <UFormField label="Notizen" class="mt-2"><UTextarea rows="6" :model-value="sheet.notes" @update:model-value="setText('notes', String($event))" /></UFormField>
    </SheetSection>
  </div>
</template>
