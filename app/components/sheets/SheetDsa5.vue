<script setup lang="ts">
import {
  DSA_ABILITIES,
  DSA_ABILITY_LABELS,
  dsa5Derived,
  type Dsa5CharacterData,
  type DsaAbility,
} from '~~/shared/engines/dsa5'
import type { GameSystem } from '~~/shared/systems'
import SheetSection from '~/components/ui/SheetSection.vue'
import StatBlock from '~/components/ui/StatBlock.vue'

const props = defineProps<{ data: Record<string, unknown>; system: GameSystem }>()
const emit = defineEmits<{ (e: 'update:data', v: Record<string, unknown>): void }>()

const sheet = computed<Dsa5CharacterData>(() => props.data as Dsa5CharacterData)
const update = (next: Dsa5CharacterData) => emit('update:data', next as unknown as Record<string, unknown>)
const clone = () => JSON.parse(JSON.stringify(sheet.value)) as Dsa5CharacterData

const derived = computed(() => dsa5Derived(sheet.value))

const setIdentity = <K extends keyof Dsa5CharacterData['identity']>(k: K, v: Dsa5CharacterData['identity'][K]) => {
  const n = clone(); n.identity[k] = v; update(n)
}
const setAbility = (k: DsaAbility, v: number) => {
  const n = clone(); n.abilities[k] = Math.max(1, v); update(n)
}
const setBase = <K extends keyof Dsa5CharacterData['derivedBase']>(k: K, v: Dsa5CharacterData['derivedBase'][K]) => {
  const n = clone(); n.derivedBase[k] = v; update(n)
}
const setState = <K extends keyof Dsa5CharacterData['state']>(k: K, v: number) => {
  const n = clone(); n.state[k] = v; update(n)
}
const setArmor = <K extends keyof Dsa5CharacterData['armor']>(k: K, v: Dsa5CharacterData['armor'][K]) => {
  const n = clone(); n.armor[k] = v; update(n)
}
const setText = <K extends 'advantages' | 'disadvantages' | 'specialAbilities' | 'inventory' | 'notes'>(k: K, v: string) => {
  const n = clone(); n[k] = v; update(n)
}

const addSkill = () => {
  const n = clone()
  n.skills.push({
    id: crypto.randomUUID(),
    name: '',
    category: 'Körper',
    probe: ['MU', 'MU', 'MU'],
    fw: 0,
    steigerung: 'B',
  })
  update(n)
}
const updateSkill = (idx: number, patch: Partial<Dsa5CharacterData['skills'][number]>) => {
  const n = clone(); n.skills[idx] = { ...n.skills[idx], ...patch }; update(n)
}
const removeSkill = (idx: number) => {
  const n = clone(); n.skills.splice(idx, 1); update(n)
}

const addWeapon = () => {
  const n = clone()
  n.weapons.push({ name: '', technique: '', at: 0, pa: 0, tp: '', rw: '', notes: '' })
  update(n)
}
const updateWeapon = (idx: number, patch: Partial<Dsa5CharacterData['weapons'][number]>) => {
  const n = clone(); n.weapons[idx] = { ...n.weapons[idx], ...patch }; update(n)
}
const removeWeapon = (idx: number) => { const n = clone(); n.weapons.splice(idx, 1); update(n) }

const addSpell = () => {
  const n = clone()
  n.spells.push({
    id: crypto.randomUUID(), name: '', probe: ['MU', 'KL', 'IN'], zfw: 0,
    cost: '', range: '', duration: '', notes: '',
  })
  update(n)
}
const updateSpell = (idx: number, patch: Partial<Dsa5CharacterData['spells'][number]>) => {
  const n = clone(); n.spells[idx] = { ...n.spells[idx], ...patch }; update(n)
}
const removeSpell = (idx: number) => { const n = clone(); n.spells.splice(idx, 1); update(n) }

const addLiturgy = () => {
  const n = clone()
  n.liturgies.push({
    id: crypto.randomUUID(), name: '', probe: ['MU', 'IN', 'CH'], lkw: 0,
    cost: '', range: '', duration: '', notes: '',
  })
  update(n)
}
const updateLiturgy = (idx: number, patch: Partial<Dsa5CharacterData['liturgies'][number]>) => {
  const n = clone(); n.liturgies[idx] = { ...n.liturgies[idx], ...patch }; update(n)
}
const removeLiturgy = (idx: number) => { const n = clone(); n.liturgies.splice(idx, 1); update(n) }

const experienceLevels: Dsa5CharacterData['identity']['experienceLevel'][] = [
  'Unerfahren', 'Durchschnittlich', 'Erfahren', 'Kompetent', 'Meisterlich', 'Brillant', 'Legendär',
]
const skillCategories: Dsa5CharacterData['skills'][number]['category'][] = [
  'Körper', 'Gesellschaft', 'Natur', 'Wissen', 'Handwerk',
]
</script>

<template>
  <div class="grid lg:grid-cols-3 gap-5">
    <SheetSection title="Stammdaten" class="lg:col-span-2">
      <div class="grid sm:grid-cols-3 gap-3">
        <UFormField label="Spezies">
          <UInput :model-value="sheet.identity.species" class="w-full" @update:model-value="setIdentity('species', String($event))" />
        </UFormField>
        <UFormField label="Kultur">
          <UInput :model-value="sheet.identity.culture" class="w-full" @update:model-value="setIdentity('culture', String($event))" />
        </UFormField>
        <UFormField label="Profession">
          <UInput :model-value="sheet.identity.profession" class="w-full" @update:model-value="setIdentity('profession', String($event))" />
        </UFormField>
        <UFormField label="Geschlecht">
          <UInput :model-value="sheet.identity.sex" class="w-full" @update:model-value="setIdentity('sex', String($event))" />
        </UFormField>
        <UFormField label="Alter">
          <UInput :model-value="sheet.identity.age" class="w-full" @update:model-value="setIdentity('age', String($event))" />
        </UFormField>
        <UFormField label="Sozialstatus">
          <UInput :model-value="sheet.identity.socialStatus" class="w-full" @update:model-value="setIdentity('socialStatus', String($event))" />
        </UFormField>
        <UFormField label="Größe">
          <UInput :model-value="sheet.identity.height" class="w-full" @update:model-value="setIdentity('height', String($event))" />
        </UFormField>
        <UFormField label="Gewicht">
          <UInput :model-value="sheet.identity.weight" class="w-full" @update:model-value="setIdentity('weight', String($event))" />
        </UFormField>
        <UFormField label="Erfahrungsgrad">
          <USelect
            :model-value="sheet.identity.experienceLevel"
            :items="experienceLevels"
            @update:model-value="setIdentity('experienceLevel', $event as Dsa5CharacterData['identity']['experienceLevel'])"
          />
        </UFormField>
        <UFormField label="AP gesamt">
          <UInput type="number" :model-value="sheet.identity.apTotal" @update:model-value="setIdentity('apTotal', Number($event))" />
        </UFormField>
        <UFormField label="AP eingesetzt">
          <UInput type="number" :model-value="sheet.identity.apSpent" @update:model-value="setIdentity('apSpent', Number($event))" />
        </UFormField>
        <UFormField label="AP frei">
          <div class="font-serif text-2xl">{{ sheet.identity.apTotal - sheet.identity.apSpent }}</div>
        </UFormField>
      </div>
    </SheetSection>

    <SheetSection title="Eigenschaften">
      <div class="grid grid-cols-4 gap-2">
        <div v-for="key in DSA_ABILITIES" :key="key" class="stat-block px-2 py-2 text-center">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">{{ DSA_ABILITY_LABELS[key] }}</div>
          <input
            type="number"
            class="parchment-input w-full text-center font-serif text-xl rounded mt-1"
            :value="sheet.abilities[key]"
            @input="setAbility(key, Number(($event.target as HTMLInputElement).value))"
          >
          <div class="text-[10px] text-ink-300">{{ key }}</div>
        </div>
      </div>
    </SheetSection>

    <SheetSection title="Abgeleitete Werte" class="lg:col-span-3">
      <div class="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
        <StatBlock label="LeP" :value="`${sheet.state.leCurrent}/${derived.lep}`" />
        <StatBlock v-if="sheet.derivedBase.asLeitEig" label="AsP" :value="`${sheet.state.asCurrent}/${derived.asp}`" />
        <StatBlock v-if="sheet.derivedBase.kpLeitEig" label="KaP" :value="`${sheet.state.kpCurrent}/${derived.kp}`" />
        <StatBlock label="SK" :value="derived.sk" />
        <StatBlock label="ZK" :value="derived.zk" />
        <StatBlock label="INI" :value="derived.ini" />
        <StatBlock label="AW" :value="derived.aw" />
        <StatBlock label="GS" :value="derived.gs" />
        <StatBlock label="WS" :value="derived.ws" />
        <StatBlock label="Schicksal" :value="`${sheet.state.schicksalspunkte - sheet.state.schicksalspunkteUsed}/${sheet.state.schicksalspunkte}`" />
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
        <UFormField label="LE-Spezies">
          <UInput type="number" :model-value="sheet.derivedBase.leBase" @update:model-value="setBase('leBase', Number($event))" />
        </UFormField>
        <UFormField label="LeP aktuell">
          <UInput type="number" :model-value="sheet.state.leCurrent" @update:model-value="setState('leCurrent', Number($event))" />
        </UFormField>
        <UFormField label="LeP-Mod">
          <UInput type="number" :model-value="sheet.derivedBase.leMod" @update:model-value="setBase('leMod', Number($event))" />
        </UFormField>
        <UFormField label="GS-Mod">
          <UInput type="number" :model-value="sheet.derivedBase.gs" @update:model-value="setBase('gs', Number($event))" />
        </UFormField>

        <UFormField label="AsP-Leiteigenschaft">
          <USelect
            :model-value="sheet.derivedBase.asLeitEig ?? ''"
            :items="['', ...DSA_ABILITIES]"
            @update:model-value="setBase('asLeitEig', ($event === '' ? null : ($event as DsaAbility)))"
          />
        </UFormField>
        <UFormField label="AE-Tradition">
          <UInput type="number" :model-value="sheet.derivedBase.asBase" @update:model-value="setBase('asBase', Number($event))" />
        </UFormField>
        <UFormField label="AsP aktuell">
          <UInput type="number" :model-value="sheet.state.asCurrent" @update:model-value="setState('asCurrent', Number($event))" />
        </UFormField>
        <UFormField label="AsP-Mod">
          <UInput type="number" :model-value="sheet.derivedBase.asMod" @update:model-value="setBase('asMod', Number($event))" />
        </UFormField>

        <UFormField label="KaP-Leiteigenschaft">
          <USelect
            :model-value="sheet.derivedBase.kpLeitEig ?? ''"
            :items="['', ...DSA_ABILITIES]"
            @update:model-value="setBase('kpLeitEig', ($event === '' ? null : ($event as DsaAbility)))"
          />
        </UFormField>
        <UFormField label="KE-Tradition">
          <UInput type="number" :model-value="sheet.derivedBase.kpBase" @update:model-value="setBase('kpBase', Number($event))" />
        </UFormField>
        <UFormField label="KaP aktuell">
          <UInput type="number" :model-value="sheet.state.kpCurrent" @update:model-value="setState('kpCurrent', Number($event))" />
        </UFormField>
        <UFormField label="KaP-Mod">
          <UInput type="number" :model-value="sheet.derivedBase.kpMod" @update:model-value="setBase('kpMod', Number($event))" />
        </UFormField>

        <UFormField label="SK-Spezies">
          <UInput type="number" :model-value="sheet.derivedBase.skBase" @update:model-value="setBase('skBase', Number($event))" />
        </UFormField>
        <UFormField label="ZK-Spezies">
          <UInput type="number" :model-value="sheet.derivedBase.zkBase" @update:model-value="setBase('zkBase', Number($event))" />
        </UFormField>
        <UFormField label="INI-Mod">
          <UInput type="number" :model-value="sheet.derivedBase.iniMod" @update:model-value="setBase('iniMod', Number($event))" />
        </UFormField>
        <UFormField label="AW-Mod">
          <UInput type="number" :model-value="sheet.derivedBase.awMod" @update:model-value="setBase('awMod', Number($event))" />
        </UFormField>
      </div>
    </SheetSection>

    <SheetSection title="Fertigkeiten" class="lg:col-span-3">
      <div v-if="!sheet.skills.length" class="text-sm text-ink-400">
        Trage hier deine Fertigkeiten ein — Probe-Eigenschaften und FW pflegst du selbst.
      </div>
      <div v-else class="space-y-1">
        <div class="hidden sm:grid grid-cols-12 gap-2 text-xs text-ink-300 px-2">
          <div class="col-span-3">Name</div>
          <div class="col-span-2">Kategorie</div>
          <div class="col-span-3">Probe</div>
          <div class="col-span-1">FW</div>
          <div class="col-span-1">Spalte</div>
          <div class="col-span-2"></div>
        </div>
        <div v-for="(s, idx) in sheet.skills" :key="s.id" class="grid grid-cols-12 gap-2 items-center">
          <UInput class="col-span-3" :model-value="s.name" @update:model-value="updateSkill(idx, { name: String($event) })" />
          <USelect class="col-span-2" :model-value="s.category" :items="skillCategories"
            @update:model-value="updateSkill(idx, { category: $event as Dsa5CharacterData['skills'][number]['category'] })" />
          <div class="col-span-3 grid grid-cols-3 gap-1">
            <USelect v-for="i in 3" :key="i" :model-value="s.probe[i - 1]" :items="DSA_ABILITIES"
              @update:model-value="updateSkill(idx, { probe: s.probe.map((p, j) => j === i - 1 ? ($event as DsaAbility) : p) as [DsaAbility, DsaAbility, DsaAbility] })" />
          </div>
          <UInput type="number" class="col-span-1" :model-value="s.fw" @update:model-value="updateSkill(idx, { fw: Number($event) })" />
          <USelect class="col-span-1" :model-value="s.steigerung" :items="['A','B','C','D']"
            @update:model-value="updateSkill(idx, { steigerung: $event as 'A'|'B'|'C'|'D' })" />
          <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" class="col-span-2 justify-self-end" @click="removeSkill(idx)" />
        </div>
      </div>
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" class="mt-2" @click="addSkill">
        Fertigkeit hinzufügen
      </UButton>
    </SheetSection>

    <SheetSection title="Waffen & Rüstung" class="lg:col-span-2">
      <div v-for="(w, idx) in sheet.weapons" :key="idx" class="grid grid-cols-12 gap-2 items-end mb-2">
        <UFormField label="Name" class="col-span-3"><UInput :model-value="w.name" @update:model-value="updateWeapon(idx, { name: String($event) })" /></UFormField>
        <UFormField label="Technik" class="col-span-2"><UInput :model-value="w.technique" @update:model-value="updateWeapon(idx, { technique: String($event) })" /></UFormField>
        <UFormField label="AT" class="col-span-1"><UInput type="number" :model-value="w.at" @update:model-value="updateWeapon(idx, { at: Number($event) })" /></UFormField>
        <UFormField label="PA" class="col-span-1"><UInput type="number" :model-value="w.pa" @update:model-value="updateWeapon(idx, { pa: Number($event) })" /></UFormField>
        <UFormField label="TP" class="col-span-2"><UInput :model-value="w.tp" @update:model-value="updateWeapon(idx, { tp: String($event) })" /></UFormField>
        <UFormField label="RW" class="col-span-2"><UInput :model-value="w.rw" @update:model-value="updateWeapon(idx, { rw: String($event) })" /></UFormField>
        <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" class="col-span-1" @click="removeWeapon(idx)" />
      </div>
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addWeapon">Waffe hinzufügen</UButton>
      <div class="grid grid-cols-3 gap-2 mt-4">
        <UFormField label="RS"><UInput type="number" :model-value="sheet.armor.rs" @update:model-value="setArmor('rs', Number($event))" /></UFormField>
        <UFormField label="BE"><UInput type="number" :model-value="sheet.armor.be" @update:model-value="setArmor('be', Number($event))" /></UFormField>
        <UFormField label="Notiz"><UInput :model-value="sheet.armor.notes" @update:model-value="setArmor('notes', String($event))" /></UFormField>
      </div>
    </SheetSection>

    <SheetSection title="Vor-/Nachteile, SF">
      <UFormField label="Vorteile"><UTextarea rows="3" :model-value="sheet.advantages" @update:model-value="setText('advantages', String($event))" /></UFormField>
      <UFormField label="Nachteile" class="mt-2"><UTextarea rows="3" :model-value="sheet.disadvantages" @update:model-value="setText('disadvantages', String($event))" /></UFormField>
      <UFormField label="Sonderfertigkeiten" class="mt-2"><UTextarea rows="4" :model-value="sheet.specialAbilities" @update:model-value="setText('specialAbilities', String($event))" /></UFormField>
    </SheetSection>

    <SheetSection title="Zauber" class="lg:col-span-3">
      <div v-for="(s, idx) in sheet.spells" :key="s.id" class="grid grid-cols-12 gap-2 items-end mb-2">
        <UFormField label="Name" class="col-span-3"><UInput :model-value="s.name" @update:model-value="updateSpell(idx, { name: String($event) })" /></UFormField>
        <div class="col-span-3 grid grid-cols-3 gap-1">
          <USelect v-for="i in 3" :key="i" :model-value="s.probe[i - 1]" :items="DSA_ABILITIES"
            @update:model-value="updateSpell(idx, { probe: s.probe.map((p, j) => j === i - 1 ? ($event as DsaAbility) : p) as [DsaAbility, DsaAbility, DsaAbility] })" />
        </div>
        <UFormField label="ZfW" class="col-span-1"><UInput type="number" :model-value="s.zfw" @update:model-value="updateSpell(idx, { zfw: Number($event) })" /></UFormField>
        <UFormField label="Kosten" class="col-span-2"><UInput :model-value="s.cost" @update:model-value="updateSpell(idx, { cost: String($event) })" /></UFormField>
        <UFormField label="Reichweite" class="col-span-2"><UInput :model-value="s.range" @update:model-value="updateSpell(idx, { range: String($event) })" /></UFormField>
        <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" class="col-span-1" @click="removeSpell(idx)" />
      </div>
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addSpell">Zauber hinzufügen</UButton>
    </SheetSection>

    <SheetSection title="Liturgien" class="lg:col-span-3">
      <div v-for="(l, idx) in sheet.liturgies" :key="l.id" class="grid grid-cols-12 gap-2 items-end mb-2">
        <UFormField label="Name" class="col-span-3"><UInput :model-value="l.name" @update:model-value="updateLiturgy(idx, { name: String($event) })" /></UFormField>
        <div class="col-span-3 grid grid-cols-3 gap-1">
          <USelect v-for="i in 3" :key="i" :model-value="l.probe[i - 1]" :items="DSA_ABILITIES"
            @update:model-value="updateLiturgy(idx, { probe: l.probe.map((p, j) => j === i - 1 ? ($event as DsaAbility) : p) as [DsaAbility, DsaAbility, DsaAbility] })" />
        </div>
        <UFormField label="LkW" class="col-span-1"><UInput type="number" :model-value="l.lkw" @update:model-value="updateLiturgy(idx, { lkw: Number($event) })" /></UFormField>
        <UFormField label="Kosten" class="col-span-2"><UInput :model-value="l.cost" @update:model-value="updateLiturgy(idx, { cost: String($event) })" /></UFormField>
        <UFormField label="Reichweite" class="col-span-2"><UInput :model-value="l.range" @update:model-value="updateLiturgy(idx, { range: String($event) })" /></UFormField>
        <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" class="col-span-1" @click="removeLiturgy(idx)" />
      </div>
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addLiturgy">Liturgie hinzufügen</UButton>
    </SheetSection>

    <SheetSection title="Inventar & Notizen" class="lg:col-span-3">
      <UFormField label="Inventar"><UTextarea rows="6" :model-value="sheet.inventory" @update:model-value="setText('inventory', String($event))" /></UFormField>
      <UFormField label="Notizen" class="mt-2"><UTextarea rows="6" :model-value="sheet.notes" @update:model-value="setText('notes', String($event))" /></UFormField>
    </SheetSection>
  </div>
</template>
