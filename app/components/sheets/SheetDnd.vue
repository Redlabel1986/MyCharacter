<script setup lang="ts">
import {
  abilityModifier,
  carryingCapacity,
  DND_ABILITIES,
  DND_SKILLS,
  initiativeTotal,
  levelFromXp,
  passivePerception,
  proficiencyBonus,
  saveBonus,
  skillBonus,
  spellAttackBonus,
  spellSaveDC,
  totalLevel,
  type DnDAbility,
  type DnDCharacterData,
} from '~~/shared/engines/dnd'
import type { GameSystem } from '~~/shared/systems'
import SheetSection from '~/components/ui/SheetSection.vue'
import StatBlock from '~/components/ui/StatBlock.vue'

const props = defineProps<{
  data: Record<string, unknown>
  system: GameSystem
}>()
const emit = defineEmits<{
  (e: 'update:data', v: Record<string, unknown>): void
}>()

const sheet = computed<DnDCharacterData>(() => props.data as unknown as DnDCharacterData)
const update = (next: DnDCharacterData) => emit('update:data', next as unknown as Record<string, unknown>)

const formatMod = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

const lvl = computed(() => totalLevel(sheet.value))
const pb = computed(() => proficiencyBonus(lvl.value))
const lvlFromXp = computed(() => levelFromXp(sheet.value.identity.xp))

const setAbility = (key: DnDAbility, score: number) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.abilities[key].score = Math.max(1, Math.min(30, score))
  update(next)
}
const toggleSaveProf = (key: DnDAbility) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.abilities[key].saveProficient = !next.abilities[key].saveProficient
  update(next)
}
const toggleSkillProf = (key: string) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  const s = next.skills[key]!
  s.proficient = !s.proficient
  if (!s.proficient) s.expertise = false
  update(next)
}
const toggleSkillExp = (key: string) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  const s = next.skills[key]!
  s.expertise = !s.expertise
  if (s.expertise) s.proficient = true
  update(next)
}
const setIdentity = <K extends keyof DnDCharacterData['identity']>(key: K, value: DnDCharacterData['identity'][K]) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.identity[key] = value
  update(next)
}
const setClass = (idx: number, patch: Partial<DnDCharacterData['identity']['classes'][number]>) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.identity.classes[idx] = { ...next.identity.classes[idx]!, ...patch }
  update(next)
}
const addClass = () => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.identity.classes.push({ name: '', level: 1, hitDie: 'd8' })
  update(next)
}
const removeClass = (idx: number) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.identity.classes.splice(idx, 1)
  if (next.identity.classes.length === 0) next.identity.classes.push({ name: '', level: 1, hitDie: 'd8' })
  update(next)
}

const setCombat = <K extends keyof DnDCharacterData['combat']>(key: K, value: DnDCharacterData['combat'][K]) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.combat[key] = value
  update(next)
}

const addAttack = () => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.attacks.push({ name: '', attackBonus: '', damage: '', damageType: '', range: '', notes: '' })
  update(next)
}
const removeAttack = (idx: number) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.attacks.splice(idx, 1)
  update(next)
}
const setAttack = (idx: number, patch: Partial<DnDCharacterData['attacks'][number]>) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.attacks[idx] = { ...next.attacks[idx]!, ...patch }
  update(next)
}

const setRoleplay = <K extends keyof DnDCharacterData['roleplay']>(key: K, value: string) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.roleplay[key] = value as unknown as DnDCharacterData['roleplay'][K]
  update(next)
}

const setSpellSlots = (idx: number, patch: { total?: number; used?: number }) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.spellcasting.slots[idx] = { ...next.spellcasting.slots[idx]!, ...patch }
  update(next)
}

const setSpellcasting = <K extends keyof DnDCharacterData['spellcasting']>(key: K, value: DnDCharacterData['spellcasting'][K]) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.spellcasting[key] = value
  update(next)
}

const setSpellcastingAbility = (value: unknown) => {
  setSpellcasting('ability', (value ?? '') as DnDAbility | '')
}

const setProficiencies = <K extends keyof DnDCharacterData['proficiencies']>(key: K, value: string) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.proficiencies[key] = value
  update(next)
}

const setCurrency = <K extends keyof DnDCharacterData['currency']>(key: K, value: number) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.currency[key] = value
  update(next)
}

const setSpeed = <K extends keyof DnDCharacterData['combat']['speed']>(key: K, value: number) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.combat.speed[key] = value
  update(next)
}

const setHp = <K extends keyof DnDCharacterData['combat']['hp']>(key: K, value: number) => {
  const next: DnDCharacterData = JSON.parse(JSON.stringify(sheet.value))
  next.combat.hp[key] = value
  update(next)
}
</script>

<template>
  <div class="grid lg:grid-cols-3 gap-5">
    <SheetSection title="Identität" class="lg:col-span-2">
      <div class="grid sm:grid-cols-2 gap-3">
        <UFormField label="Spezies / Race">
          <UInput :model-value="sheet.identity.species" class="w-full" @update:model-value="setIdentity('species', String($event))" />
        </UFormField>
        <UFormField label="Hintergrund">
          <UInput :model-value="sheet.identity.background" class="w-full" @update:model-value="setIdentity('background', String($event))" />
        </UFormField>
        <UFormField label="Gesinnung">
          <UInput :model-value="sheet.identity.alignment" class="w-full" @update:model-value="setIdentity('alignment', String($event))" />
        </UFormField>
        <UFormField label="Spielername">
          <UInput :model-value="sheet.identity.playerName" class="w-full" @update:model-value="setIdentity('playerName', String($event))" />
        </UFormField>
        <UFormField label="XP">
          <UInput type="number" :model-value="sheet.identity.xp" class="w-full" @update:model-value="setIdentity('xp', Number($event))" />
        </UFormField>
        <UFormField :label="`Stufe (XP-Level: ${lvlFromXp})`">
          <div class="font-serif text-2xl">{{ lvl }}</div>
        </UFormField>
      </div>

      <div class="mt-4">
        <div class="flex items-center justify-between">
          <div class="font-semibold text-sm">Klassen</div>
          <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addClass">Klasse hinzufügen</UButton>
        </div>
        <div class="space-y-2 mt-2">
          <div v-for="(cls, idx) in sheet.identity.classes" :key="idx" class="grid grid-cols-12 gap-2 items-end">
            <UFormField label="Name" class="col-span-5">
              <UInput :model-value="cls.name" @update:model-value="setClass(idx, { name: String($event) })" />
            </UFormField>
            <UFormField label="Subklasse" class="col-span-3">
              <UInput :model-value="cls.subclass ?? ''" @update:model-value="setClass(idx, { subclass: String($event) })" />
            </UFormField>
            <UFormField label="Stufe" class="col-span-2">
              <UInput type="number" :model-value="cls.level" @update:model-value="setClass(idx, { level: Number($event) })" />
            </UFormField>
            <UFormField label="HD" class="col-span-1">
              <USelect
                :model-value="cls.hitDie"
                :items="['d6','d8','d10','d12']"
                @update:model-value="setClass(idx, { hitDie: $event as 'd6'|'d8'|'d10'|'d12' })"
              />
            </UFormField>
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" class="col-span-1" @click="removeClass(idx)" />
          </div>
        </div>
      </div>

      <div class="mt-4 flex items-center gap-3">
        <label class="flex items-center gap-2 text-sm">
          <UCheckbox :model-value="sheet.identity.inspiration" @update:model-value="setIdentity('inspiration', !!$event)" />
          {{ system === 'dnd2024' ? 'Heroic Inspiration' : 'Inspiration' }}
        </label>
        <span class="text-xs text-ink-300">Proficiency Bonus: <strong>{{ formatMod(pb) }}</strong></span>
      </div>
    </SheetSection>

    <SheetSection title="Attribute">
      <div class="grid grid-cols-3 gap-3">
        <div v-for="key in DND_ABILITIES" :key="key" class="stat-block px-2 py-3 text-center">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">{{ key }}</div>
          <input
            type="number"
            class="parchment-input w-full text-center font-serif text-2xl rounded mt-1"
            :value="sheet.abilities[key].score"
            @input="setAbility(key, Number(($event.target as HTMLInputElement).value))"
          >
          <div class="text-sm font-semibold mt-1">
            Mod {{ formatMod(abilityModifier(sheet.abilities[key].score)) }}
          </div>
          <label class="flex items-center justify-center gap-1 text-[11px] mt-1">
            <UCheckbox :model-value="sheet.abilities[key].saveProficient" @update:model-value="toggleSaveProf(key)" />
            Save: {{ formatMod(saveBonus(sheet, key)) }}
          </label>
        </div>
      </div>
    </SheetSection>

    <SheetSection title="Kampf" class="lg:col-span-1">
      <div class="grid grid-cols-3 gap-2">
        <StatBlock :label="'AC'" :value="sheet.combat.armorClass" />
        <StatBlock :label="'INI'" :value="formatMod(initiativeTotal(sheet))" />
        <StatBlock :label="'Speed'" :value="`${sheet.combat.speed.walk} ft`" />
      </div>
      <div class="grid grid-cols-3 gap-2 mt-2">
        <UFormField label="AC">
          <UInput type="number" :model-value="sheet.combat.armorClass" @update:model-value="setCombat('armorClass', Number($event))" />
        </UFormField>
        <UFormField label="Init-Mod">
          <UInput type="number" :model-value="sheet.combat.initiativeBonus" @update:model-value="setCombat('initiativeBonus', Number($event))" />
        </UFormField>
        <UFormField label="Walk">
          <UInput type="number" :model-value="sheet.combat.speed.walk" @update:model-value="setSpeed('walk', Number($event))" />
        </UFormField>
      </div>
      <div class="mt-3">
        <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">Trefferpunkte</div>
        <div class="grid grid-cols-3 gap-2">
          <UFormField label="Aktuell">
            <UInput type="number" :model-value="sheet.combat.hp.current" @update:model-value="setHp('current', Number($event))" />
          </UFormField>
          <UFormField label="Max">
            <UInput type="number" :model-value="sheet.combat.hp.max" @update:model-value="setHp('max', Number($event))" />
          </UFormField>
          <UFormField label="Temp">
            <UInput type="number" :model-value="sheet.combat.hp.temp" @update:model-value="setHp('temp', Number($event))" />
          </UFormField>
        </div>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <StatBlock label="Passive Perception" :value="passivePerception(sheet)" />
        <StatBlock label="Carry (lbs)" :value="carryingCapacity(sheet.abilities.STR.score)" />
      </div>
    </SheetSection>

    <SheetSection title="Skills" class="lg:col-span-2">
      <div class="grid sm:grid-cols-2 gap-x-4 gap-y-1">
        <div v-for="s in DND_SKILLS" :key="s.key" class="flex items-center gap-2 py-1 border-b border-parchment-700/15">
          <UCheckbox :model-value="sheet.skills[s.key]?.proficient ?? false" @update:model-value="toggleSkillProf(s.key)" />
          <UCheckbox :model-value="sheet.skills[s.key]?.expertise ?? false" @update:model-value="toggleSkillExp(s.key)" />
          <span class="flex-1 text-sm">{{ s.label }} <span class="text-ink-300">({{ s.ability }})</span></span>
          <span class="font-serif text-lg w-10 text-right">{{ formatMod(skillBonus(sheet, s.key).value) }}</span>
        </div>
      </div>
      <p class="text-xs text-ink-300 mt-2">Linke Box = Proficient, rechte Box = Expertise.</p>
    </SheetSection>

    <SheetSection title="Angriffe" class="lg:col-span-3">
      <div v-if="!sheet.attacks.length" class="text-sm text-ink-400">
        Noch keine Angriffe.
      </div>
      <div v-else class="space-y-2">
        <div v-for="(a, idx) in sheet.attacks" :key="idx" class="grid grid-cols-12 gap-2 items-end">
          <UFormField label="Name" class="col-span-3">
            <UInput :model-value="a.name" @update:model-value="setAttack(idx, { name: String($event) })" />
          </UFormField>
          <UFormField label="Bonus" class="col-span-2">
            <UInput :model-value="a.attackBonus" @update:model-value="setAttack(idx, { attackBonus: String($event) })" />
          </UFormField>
          <UFormField label="Schaden" class="col-span-2">
            <UInput :model-value="a.damage" @update:model-value="setAttack(idx, { damage: String($event) })" />
          </UFormField>
          <UFormField label="Typ" class="col-span-2">
            <UInput :model-value="a.damageType" @update:model-value="setAttack(idx, { damageType: String($event) })" />
          </UFormField>
          <UFormField label="Reichweite" class="col-span-2">
            <UInput :model-value="a.range" @update:model-value="setAttack(idx, { range: String($event) })" />
          </UFormField>
          <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" class="col-span-1" @click="removeAttack(idx)" />
        </div>
      </div>
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" class="mt-2" @click="addAttack">
        Angriff hinzufügen
      </UButton>
    </SheetSection>

    <SheetSection title="Zauberwerk" class="lg:col-span-2">
      <div class="grid grid-cols-3 gap-2">
        <UFormField label="Spellcasting Ability">
          <div class="flex gap-2 items-center">
            <USelect
              :model-value="sheet.spellcasting.ability || undefined"
              :items="[...DND_ABILITIES]"
              placeholder="—"
              class="w-full"
              @update:model-value="setSpellcastingAbility"
            />
            <UButton
              v-if="sheet.spellcasting.ability"
              size="xs"
              variant="ghost"
              icon="i-lucide-x"
              @click="setSpellcasting('ability', '')"
            />
          </div>
        </UFormField>
        <StatBlock label="Spell Save DC" :value="spellSaveDC(sheet) ?? '–'" />
        <StatBlock label="Spell Atk" :value="spellAttackBonus(sheet) !== null ? formatMod(spellAttackBonus(sheet)!) : '–'" />
      </div>
      <UFormField label="Bekannte / Vorbereitete Zauber" class="mt-3">
        <UTextarea
          :model-value="sheet.spellcasting.spells"
          :rows="6"
          class="w-full"
          @update:model-value="setSpellcasting('spells', String($event))"
        />
      </UFormField>
      <div class="mt-3">
        <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">Spell Slots</div>
        <div class="grid grid-cols-3 sm:grid-cols-9 gap-1">
          <div v-for="(slot, idx) in sheet.spellcasting.slots" :key="slot.level" class="stat-block px-2 py-1 text-center text-xs">
            <div>L{{ slot.level }}</div>
            <input
              type="number"
              :value="slot.used"
              class="parchment-input w-full text-center"
              @input="setSpellSlots(idx, { used: Number(($event.target as HTMLInputElement).value) })"
            >
            <div class="text-ink-300">/ <input
              type="number"
              :value="slot.total"
              class="parchment-input w-10 text-center inline"
              @input="setSpellSlots(idx, { total: Number(($event.target as HTMLInputElement).value) })"
            ></div>
          </div>
        </div>
      </div>
    </SheetSection>

    <SheetSection title="Inventar & Münzen" class="lg:col-span-3">
      <UFormField label="Ausrüstung (Freitext)">
        <UTextarea
          :model-value="sheet.equipment"
          :rows="6"
          class="w-full"
          @update:model-value="emit('update:data', { ...sheet, equipment: String($event) } as unknown as Record<string, unknown>)"
        />
      </UFormField>
      <div class="grid grid-cols-5 gap-2 mt-3">
        <UFormField v-for="key in (['cp','sp','ep','gp','pp'] as const)" :key="key" :label="key.toUpperCase()">
          <UInput type="number" :model-value="sheet.currency[key]" @update:model-value="setCurrency(key, Number($event))" />
        </UFormField>
      </div>
    </SheetSection>

    <SheetSection title="Sprachen, Werkzeuge, Rüstung" class="lg:col-span-2">
      <div class="grid sm:grid-cols-2 gap-3">
        <UFormField label="Sprachen">
          <UTextarea :model-value="sheet.proficiencies.languages" :rows="3" class="w-full" @update:model-value="setProficiencies('languages', String($event))" />
        </UFormField>
        <UFormField label="Werkzeuge">
          <UTextarea :model-value="sheet.proficiencies.tools" :rows="3" class="w-full" @update:model-value="setProficiencies('tools', String($event))" />
        </UFormField>
        <UFormField label="Waffen-Proficiency">
          <UTextarea :model-value="sheet.proficiencies.weapons" :rows="3" class="w-full" @update:model-value="setProficiencies('weapons', String($event))" />
        </UFormField>
        <UFormField label="Rüstungs-Proficiency">
          <UTextarea :model-value="sheet.proficiencies.armor" :rows="3" class="w-full" @update:model-value="setProficiencies('armor', String($event))" />
        </UFormField>
      </div>
    </SheetSection>

    <SheetSection title="Features & Feats">
      <UFormField label="Features (Klasse, Spezies, Background)">
        <UTextarea
          :model-value="sheet.features"
          :rows="6"
          class="w-full"
          @update:model-value="emit('update:data', { ...sheet, features: String($event) } as unknown as Record<string, unknown>)"
        />
      </UFormField>
      <UFormField label="Feats" class="mt-2">
        <UTextarea
          :model-value="sheet.feats"
          :rows="4"
          class="w-full"
          @update:model-value="emit('update:data', { ...sheet, feats: String($event) } as unknown as Record<string, unknown>)"
        />
      </UFormField>
    </SheetSection>

    <SheetSection title="Persönlichkeit & Hintergrund" class="lg:col-span-3">
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <UFormField label="Persönlichkeit">
          <UTextarea :model-value="sheet.roleplay.personalityTraits" :rows="3" class="w-full" @update:model-value="setRoleplay('personalityTraits', String($event))" />
        </UFormField>
        <UFormField label="Ideale">
          <UTextarea :model-value="sheet.roleplay.ideals" :rows="3" class="w-full" @update:model-value="setRoleplay('ideals', String($event))" />
        </UFormField>
        <UFormField label="Bindungen">
          <UTextarea :model-value="sheet.roleplay.bonds" :rows="3" class="w-full" @update:model-value="setRoleplay('bonds', String($event))" />
        </UFormField>
        <UFormField label="Makel">
          <UTextarea :model-value="sheet.roleplay.flaws" :rows="3" class="w-full" @update:model-value="setRoleplay('flaws', String($event))" />
        </UFormField>
        <UFormField label="Aussehen" class="lg:col-span-2">
          <UTextarea :model-value="sheet.roleplay.appearance" :rows="3" class="w-full" @update:model-value="setRoleplay('appearance', String($event))" />
        </UFormField>
        <UFormField label="Hintergrundgeschichte" class="lg:col-span-2">
          <UTextarea :model-value="sheet.roleplay.backstory" :rows="3" class="w-full" @update:model-value="setRoleplay('backstory', String($event))" />
        </UFormField>
      </div>
    </SheetSection>
  </div>
</template>
