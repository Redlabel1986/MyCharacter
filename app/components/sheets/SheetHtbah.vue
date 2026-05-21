<script setup lang="ts">
import {
  HTBAH_TALENTS,
  HTBAH_TALENT_LABELS,
  HTBAH_SKILL_CAP,
  htbahSkillTotal,
  htbahTalentValue,
  htbahInsightMax,
  htbahCalcSpentPoints,
  htbahPointsRemaining,
  htbahPoolTotal,
  htbahInitiativeBonus,
  htbahStatus,
  htbahRollProbe,
  htbahCritThreshold,
  htbahFumbleThreshold,
  htbahQualityLabel,
  normalizeHtbahPurse,
  createBlankHtbah,
  htbahTotalArmor,
  type HtbahCharacterData,
  type HtbahTalent,
  type HtbahSkill,
  type HtbahPerk,
  type HtbahPurse,
  type HtbahArmorPiece,
  type HtbahWeaponEntry,
  type HtbahSpellEntry,
  type HtbahSpellLevel,
  type HtbahUsableItem,
} from '~~/shared/engines/htbah'
import type { GameSystem } from '~~/shared/systems'
import SheetSection from '~/components/ui/SheetSection.vue'
import StatBlock from '~/components/ui/StatBlock.vue'

const props = defineProps<{
  data: Record<string, unknown>
  system: GameSystem
  /** Charakter-ID. Wenn gesetzt, kann „An Gruppe wuerfeln" benutzt werden. */
  characterId?: number
}>()
const emit = defineEmits<{ (e: 'update:data', v: Record<string, unknown>): void }>()

// Mit Blank mergen — schützt alte Charaktere und ignoriert deprecated Felder.
const sheet = computed<HtbahCharacterData>(() => {
  const blank = createBlankHtbah('')
  const incoming = (props.data ?? {}) as Partial<HtbahCharacterData> & {
    inspiration?: number
    level?: number
    skillCap?: number
    identity?: Partial<HtbahCharacterData['identity']> & {
      advantages?: unknown
      disadvantages?: unknown
    }
  }
  // Identity: deprecated string-Felder (advantages/disadvantages) ausfiltern.
  const { advantages: _legacyAdv, disadvantages: _legacyDis, ...incomingIdentity } =
    incoming.identity ?? {}
  return {
    ...blank,
    identity: { ...blank.identity, ...incomingIdentity },
    hp: { ...blank.hp, ...(incoming.hp ?? {}) },
    pointsPool: { ...blank.pointsPool, ...(incoming.pointsPool ?? {}) },
    talents: {
      handeln: {
        insightCurrent: incoming.talents?.handeln?.insightCurrent ?? 0,
      },
      wissen: {
        insightCurrent: incoming.talents?.wissen?.insightCurrent ?? 0,
      },
      soziales: {
        insightCurrent: incoming.talents?.soziales?.insightCurrent ?? 0,
      },
    },
    skills: (incoming.skills ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      talent: s.talent,
      spentPoints: s.spentPoints || 0,
      modifier: s.modifier || 0,
      dayBonus: s.dayBonus || 0,
      nightBonus: s.nightBonus || 0,
      note: s.note || '',
    })),
    advantages: incoming.advantages ?? [],
    disadvantages: incoming.disadvantages ?? [],
    backstory: { ...blank.backstory, ...(incoming.backstory ?? {}) },
    inventory: incoming.inventory ?? '',
    beute: incoming.beute ?? '',
    armor: Array.isArray(incoming.armor) ? incoming.armor : [],
    weapons: Array.isArray(incoming.weapons) ? incoming.weapons : [],
    usableItems: Array.isArray(incoming.usableItems)
      ? incoming.usableItems.map((i) => ({
          id: i.id,
          name: i.name ?? '',
          healAmount: Math.max(0, Math.floor(Number(i.healAmount ?? 0))),
          quantity: Math.max(0, Math.floor(Number(i.quantity ?? 0))),
          note: i.note ?? '',
        }))
      : [],
    spells: Array.isArray(incoming.spells)
      ? incoming.spells.map((s) => ({
          id: s.id,
          name: s.name ?? '',
          skillId: s.skillId ?? '',
          levels: Array.isArray(s.levels)
            ? s.levels.map((l) => ({
                id: l.id,
                label: l.label ?? '',
                kind: l.kind === 'heal' ? 'heal' : 'damage',
                modifier: Number(l.modifier ?? 0),
                damageFormula: l.damageFormula ?? '',
                note: l.note ?? '',
              }))
            : [],
          note: s.note ?? '',
        }))
      : [],
    purse: {
      copper: Number(incoming.purse?.copper ?? 0),
      silver: Number(incoming.purse?.silver ?? 0),
      gold: Number(incoming.purse?.gold ?? 0),
    },
    magic: incoming.magic ?? '',
    notes: incoming.notes ?? '',
  }
})

const update = (n: HtbahCharacterData) =>
  emit('update:data', n as unknown as Record<string, unknown>)
const clone = () => JSON.parse(JSON.stringify(sheet.value)) as HtbahCharacterData

const setIdentity = <K extends keyof HtbahCharacterData['identity']>(k: K, v: string) => {
  const n = clone(); n.identity[k] = v; update(n)
}
const setHp = <K extends keyof HtbahCharacterData['hp']>(k: K, v: number) => {
  const n = clone(); n.hp[k] = v; update(n)
}
const setPoolTotal = (v: number) => { const n = clone(); n.pointsPool.total = v; update(n) }
const setRacePoints = (v: number) => { const n = clone(); n.pointsPool.racePoints = v; update(n) }
const setBackstoryText = (v: string) => { const n = clone(); n.backstory.text = v; update(n) }
const setBackstoryPoints = (v: number) => { const n = clone(); n.backstory.points = v; update(n) }

const addPerk = (kind: 'advantages' | 'disadvantages') => {
  const n = clone()
  n[kind].push({ id: crypto.randomUUID(), name: '', cost: 0, note: '' })
  update(n)
}
const updatePerk = (
  kind: 'advantages' | 'disadvantages',
  idx: number,
  patch: Partial<HtbahPerk>,
) => {
  const n = clone()
  const current = n[kind][idx]
  if (!current) return
  n[kind][idx] = { ...current, ...patch }
  update(n)
}
const removePerk = (kind: 'advantages' | 'disadvantages', idx: number) => {
  const n = clone(); n[kind].splice(idx, 1); update(n)
}
const setInsightCurrent = (t: HtbahTalent, v: number) => {
  const n = clone(); n.talents[t].insightCurrent = v; update(n)
}
const setText = <K extends 'inventory' | 'notes' | 'beute' | 'magic'>(k: K, v: string) => {
  const n = clone(); n[k] = v; update(n)
}
// Geldbeutel: erst die Rohzahl uebernehmen, beim Verlassen des Felds
// normalisieren (100 Kupfer -> 1 Silber, 100 Silber -> 1 Gold). So bleibt
// "150" beim Tippen sichtbar und wird erst nach Blur in 50/1 zerlegt.
const setPurseRaw = <K extends keyof HtbahPurse>(k: K, v: number) => {
  const n = clone()
  n.purse = { ...n.purse, [k]: Number.isFinite(v) ? Math.floor(v) : 0 }
  update(n)
}
const applyPurseNormalize = () => {
  const n = clone()
  n.purse = normalizeHtbahPurse(n.purse)
  update(n)
}
// --- Ruestung ---
// Wird beim Schadenswurf vom eingehenden Schaden abgezogen. Summe siehe
// htbahTotalArmor(); im Bogen pflegt der Spieler beliebig viele Teile.
const totalArmor = computed(() => htbahTotalArmor(sheet.value))
const addArmor = () => {
  const n = clone()
  if (!n.armor) n.armor = []
  n.armor.push({ id: crypto.randomUUID(), name: '', value: 0 })
  update(n)
}
const updateArmor = (idx: number, patch: Partial<HtbahArmorPiece>) => {
  const n = clone()
  const list = n.armor ?? []
  const current = list[idx]
  if (!current) return
  list[idx] = { ...current, ...patch }
  n.armor = list
  update(n)
}
const removeArmor = (idx: number) => {
  const n = clone()
  const list = n.armor ?? []
  list.splice(idx, 1)
  n.armor = list
  update(n)
}

// --- Waffen ---
const addWeapon = () => {
  const n = clone()
  if (!n.weapons) n.weapons = []
  n.weapons.push({ id: crypto.randomUUID(), name: '', damageFormula: '' })
  update(n)
}
const updateWeapon = (idx: number, patch: Partial<HtbahWeaponEntry>) => {
  const n = clone()
  const list = n.weapons ?? []
  const current = list[idx]
  if (!current) return
  list[idx] = { ...current, ...patch }
  n.weapons = list
  update(n)
}
const removeWeapon = (idx: number) => {
  const n = clone()
  const list = n.weapons ?? []
  list.splice(idx, 1)
  n.weapons = list
  update(n)
}

// --- Verwendbare Gegenstaende (Heiltrank, Erste-Hilfe-Paket, …) ---
const addUsableItem = () => {
  const n = clone()
  if (!n.usableItems) n.usableItems = []
  n.usableItems.push({
    id: crypto.randomUUID(),
    name: '',
    healAmount: 0,
    quantity: 1,
    note: '',
  })
  update(n)
}
const updateUsableItem = (idx: number, patch: Partial<HtbahUsableItem>) => {
  const n = clone()
  const list = n.usableItems ?? []
  const current = list[idx]
  if (!current) return
  list[idx] = { ...current, ...patch }
  n.usableItems = list
  update(n)
}
const removeUsableItem = (idx: number) => {
  const n = clone()
  const list = n.usableItems ?? []
  list.splice(idx, 1)
  n.usableItems = list
  update(n)
}

// --- Zauber & Magie-Faehigkeiten ---
// Jeder Zauber referenziert einen Skill (Probe). Die Stufen modifizieren die
// Probe (modifier) und liefern die Schadensformel. Im Mini-Charsheet wird der
// gewaehlte Zauber + Stufe in Probe-Skill, Probe-Mod und Damage-Formel uebertragen.
const addSpell = () => {
  const n = clone()
  if (!n.spells) n.spells = []
  n.spells.push({
    id: crypto.randomUUID(),
    name: '',
    skillId: '',
    levels: [
      { id: crypto.randomUUID(), label: 'Stufe 1', modifier: 0, damageFormula: '' },
    ],
    note: '',
  })
  update(n)
}
const updateSpell = (idx: number, patch: Partial<HtbahSpellEntry>) => {
  const n = clone()
  const list = n.spells ?? []
  const current = list[idx]
  if (!current) return
  list[idx] = { ...current, ...patch }
  n.spells = list
  update(n)
}
const removeSpell = (idx: number) => {
  const n = clone()
  const list = n.spells ?? []
  list.splice(idx, 1)
  n.spells = list
  update(n)
}
const addSpellLevel = (spellIdx: number) => {
  const n = clone()
  const list = n.spells ?? []
  const spell = list[spellIdx]
  if (!spell) return
  const nextNum = (spell.levels?.length ?? 0) + 1
  spell.levels = [
    ...(spell.levels ?? []),
    {
      id: crypto.randomUUID(),
      label: `Stufe ${nextNum}`,
      modifier: 0,
      damageFormula: '',
    },
  ]
  n.spells = list
  update(n)
}
const updateSpellLevel = (
  spellIdx: number,
  levelIdx: number,
  patch: Partial<HtbahSpellLevel>,
) => {
  const n = clone()
  const list = n.spells ?? []
  const spell = list[spellIdx]
  if (!spell) return
  const lvl = spell.levels?.[levelIdx]
  if (!lvl) return
  spell.levels[levelIdx] = { ...lvl, ...patch }
  n.spells = list
  update(n)
}
const removeSpellLevel = (spellIdx: number, levelIdx: number) => {
  const n = clone()
  const list = n.spells ?? []
  const spell = list[spellIdx]
  if (!spell || !spell.levels) return
  spell.levels.splice(levelIdx, 1)
  n.spells = list
  update(n)
}

// Skill-Auswahl-Optionen fuer das Zauber-"Probe-gegen"-Dropdown.
const spellSkillOptions = computed(() => [
  { label: '— Skill waehlen —', value: '' },
  ...sheet.value.skills
    .filter((s: HtbahSkill) => s.name?.trim())
    .map((s: HtbahSkill) => ({
      label: `${s.name} (${HTBAH_TALENT_LABELS[s.talent]} · FW ${htbahSkillTotal(sheet.value, s)})`,
      value: s.id,
    })),
])

const refreshAllInsights = () => {
  const n = clone()
  for (const t of HTBAH_TALENTS) {
    n.talents[t].insightCurrent = htbahInsightMax(n, t)
  }
  update(n)
}

const addSkill = (talent: HtbahTalent) => {
  const n = clone()
  n.skills.push({
    id: crypto.randomUUID(),
    name: '',
    talent,
    spentPoints: 0,
    modifier: 0,
    dayBonus: 0,
    nightBonus: 0,
    note: '',
  })
  update(n)
}
const updateSkill = (idx: number, patch: Partial<HtbahSkill>) => {
  const n = clone()
  const existing = n.skills[idx]
  if (!existing) return
  n.skills[idx] = { ...existing, ...patch }
  update(n)
}
const removeSkill = (idx: number) => { const n = clone(); n.skills.splice(idx, 1); update(n) }

const skillsByTalent = computed(() => {
  const map: Record<HtbahTalent, Array<{ idx: number; skill: HtbahSkill }>> = {
    handeln: [], wissen: [], soziales: [],
  }
  sheet.value.skills.forEach((skill, idx) => {
    if (map[skill.talent]) map[skill.talent].push({ idx, skill })
  })
  return map
})

const remaining = computed(() => htbahPointsRemaining(sheet.value))
const effectivePool = computed(() => htbahPoolTotal(sheet.value))
const status = computed(() => htbahStatus(sheet.value.hp))
const statusLabel = computed(() => {
  switch (status.value) {
    case 'tot': return 'Tot'
    case 'bewusstlos': return 'Bewusstlos'
    default: return 'Normal'
  }
})

// — Probe würfeln —
const probeTargetId = ref<string | undefined>(undefined)
const probeRoll = ref<number | null>(null)

interface ProbeOption { label: string; value: string; group?: string }
const probeOptions = computed<ProbeOption[]>(() => {
  const items: ProbeOption[] = []
  for (const t of HTBAH_TALENTS) {
    const val = htbahTalentValue(sheet.value, t)
    items.push({ label: `${HTBAH_TALENT_LABELS[t]} (${val})`, value: `talent:${t}` })
  }
  for (const s of sheet.value.skills) {
    if (!s.name.trim()) continue
    const total = htbahSkillTotal(sheet.value, s)
    items.push({
      label: `${s.name} — ${HTBAH_TALENT_LABELS[s.talent]} (${total})`,
      value: `skill:${s.id}`,
    })
  }
  return items
})

const probeTarget = computed<{ value: number; label: string; isTalentOnly: boolean } | null>(() => {
  if (!probeTargetId.value) return null
  const [type, id] = probeTargetId.value.split(':')
  if (type === 'talent') {
    const tal = id as HtbahTalent
    return {
      value: htbahTalentValue(sheet.value, tal),
      label: `${HTBAH_TALENT_LABELS[tal]} (Begabungsprobe)`,
      isTalentOnly: true,
    }
  }
  if (type === 'skill') {
    const skill = sheet.value.skills.find((s) => s.id === id)
    if (!skill) return null
    return {
      value: htbahSkillTotal(sheet.value, skill),
      label: skill.name || '(unbenannt)',
      isTalentOnly: false,
    }
  }
  return null
})

const probeResult = computed(() => {
  if (!probeTarget.value || probeRoll.value === null) return null
  if (probeRoll.value < 1 || probeRoll.value > 100) return null
  return htbahRollProbe({
    roll: probeRoll.value,
    target: probeTarget.value.value,
    isTalentOnly: probeTarget.value.isTalentOnly,
  })
})

const resultText = computed(() => {
  if (!probeResult.value) return ''
  if (probeResult.value.fumble) return 'Kritischer Patzer'
  if (probeResult.value.critical) return 'Kritischer Erfolg'
  if (probeResult.value.success) return 'Erfolg'
  return 'Misserfolg'
})

// Qualitaetsstufe + Marge nur bei Erfolg (Marge = Zielwert − Wurf).
// Stufe-Schwellen: 0-19 → 1, 20-29 → 2, ..., 60-69 → 6, 70+ → Maximaler Erfolg.
const qualityText = computed(() => {
  if (!probeResult.value || !probeResult.value.success) return ''
  if (probeResult.value.qualityStep === undefined) return ''
  if (!probeTarget.value || probeRoll.value === null) return ''
  const margin = probeTarget.value.value - probeRoll.value
  return `${htbahQualityLabel(probeResult.value.qualityStep)} · um ${margin} unterboten`
})

const resultClass = computed(() => {
  if (!probeResult.value) return ''
  if (probeResult.value.fumble) return 'bg-red-700 text-white border-red-900'
  if (probeResult.value.critical) return 'bg-emerald-600 text-white border-emerald-800'
  if (probeResult.value.success) return 'bg-emerald-100 text-emerald-900 border-emerald-300'
  return 'bg-amber-100 text-amber-900 border-amber-300'
})

const resultIcon = computed(() => {
  if (!probeResult.value) return ''
  if (probeResult.value.fumble) return 'i-lucide-skull'
  if (probeResult.value.critical) return 'i-lucide-sparkles'
  if (probeResult.value.success) return 'i-lucide-check'
  return 'i-lucide-x'
})

const rollDice = () => {
  probeRoll.value = Math.floor(Math.random() * 100) + 1
}
const resetProbe = () => {
  probeRoll.value = null
}

// — An Gruppe wuerfeln —
interface GroupListItem { id: number; name: string }
const groupsForRoll = ref<GroupListItem[]>([])
const selectedGroupId = ref<number | null>(null)
const rollModifier = ref<number>(0)
const rollNote = ref<string>('')
const groupRollSending = ref(false)
const groupRollError = ref<string | null>(null)
const groupRollSuccess = ref(false)

const loadGroups = async () => {
  if (!props.characterId) return
  try {
    const res = await $fetch<{ groups: GroupListItem[] }>('/api/groups')
    groupsForRoll.value = res.groups ?? []
    if (!selectedGroupId.value && groupsForRoll.value[0]) {
      selectedGroupId.value = groupsForRoll.value[0].id
    }
  } catch {
    // still — Spieler ist evtl. in keiner Gruppe
  }
}
onMounted(loadGroups)

const groupOptions = computed(() =>
  groupsForRoll.value.map((g) => ({ label: g.name, value: g.id })),
)

const postRollToGroup = async () => {
  if (!props.characterId || !selectedGroupId.value || !probeTargetId.value) return
  groupRollSending.value = true
  groupRollError.value = null
  groupRollSuccess.value = false
  try {
    const [type, id] = probeTargetId.value.split(':')
    const body =
      type === 'skill'
        ? {
            kind: 'htbahSkill' as const,
            characterId: props.characterId,
            skillId: id,
            modifier: rollModifier.value || undefined,
            note: rollNote.value.trim() || undefined,
          }
        : {
            kind: 'htbahTalent' as const,
            characterId: props.characterId,
            talent: id as HtbahTalent,
            modifier: rollModifier.value || undefined,
            note: rollNote.value.trim() || undefined,
          }
    await $fetch(`/api/groups/${selectedGroupId.value}/rolls`, {
      method: 'POST',
      body,
    })
    groupRollSuccess.value = true
    rollNote.value = ''
    setTimeout(() => (groupRollSuccess.value = false), 2500)
  } catch (e: unknown) {
    groupRollError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Wurf konnte nicht gepostet werden.'
  } finally {
    groupRollSending.value = false
  }
}
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
        <UFormField label="Aussehen" class="sm:col-span-3"><UTextarea autoresize :rows="2" class="w-full" :model-value="sheet.identity.appearance" @update:model-value="setIdentity('appearance', String($event))" /></UFormField>
        <UFormField label="Stimme"><UInput :model-value="sheet.identity.voice" @update:model-value="setIdentity('voice', String($event))" /></UFormField>
        <UFormField label="Kleidung" class="sm:col-span-2"><UTextarea autoresize :rows="2" class="w-full" :model-value="sheet.identity.clothing" @update:model-value="setIdentity('clothing', String($event))" /></UFormField>
        <UFormField label="Vorlieben" class="sm:col-span-3"><UTextarea autoresize :rows="2" class="w-full" :model-value="sheet.identity.likes" @update:model-value="setIdentity('likes', String($event))" /></UFormField>
      </div>
    </SheetSection>

    <SheetSection title="Status">
      <div class="grid grid-cols-2 gap-2">
        <StatBlock label="LP" :value="`${sheet.hp.current}/${sheet.hp.max}`" />
        <StatBlock label="Initiative" :value="`+${htbahInitiativeBonus(sheet)}`" sublabel="W10 + Handeln" />
      </div>
      <div
        class="mt-2 text-center text-xs uppercase tracking-widest font-semibold py-1 rounded"
        :class="status === 'tot' ? 'bg-red-700 text-white'
          : status === 'bewusstlos' ? 'bg-amber-200 text-amber-900'
          : 'bg-green-100 text-green-800'"
      >
        {{ statusLabel }}
      </div>

      <div class="grid grid-cols-2 gap-2 mt-3">
        <UFormField label="LP aktuell">
          <UInput type="number" :model-value="sheet.hp.current" @update:model-value="setHp('current', Number($event))" />
        </UFormField>
        <UFormField label="LP max">
          <UInput type="number" :model-value="sheet.hp.max" @update:model-value="setHp('max', Number($event))" />
        </UFormField>
      </div>
      <p class="text-[10px] text-ink-300 mt-1">
        &lt; 10 LP = bewusstlos · 0 LP = tot · &gt; 60 Schaden in einem Treffer = sofort bewusstlos
      </p>

      <div class="accent-rule my-3" />
      <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">Punkte-Pool</div>
      <div class="grid grid-cols-2 gap-2">
        <UFormField label="Basis">
          <UInput type="number" :model-value="sheet.pointsPool.total" @update:model-value="setPoolTotal(Number($event))" />
        </UFormField>
        <UFormField label="Volkspunkte">
          <UInput type="number" :model-value="sheet.pointsPool.racePoints" @update:model-value="setRacePoints(Number($event))" />
        </UFormField>
      </div>
      <div class="grid grid-cols-3 gap-2 mt-2">
        <StatBlock label="Effektiv" :value="effectivePool" />
        <StatBlock label="Vergeben" :value="htbahCalcSpentPoints(sheet)" />
        <StatBlock label="Übrig" :value="remaining" />
      </div>
      <p class="text-[10px] text-ink-300 mt-1">
        Effektiv = Basis + Volkspunkte + Σ Nachteile − Σ Vorteile + Vorgeschichte-Bonus.
      </p>

      <div class="accent-rule my-3" />
      <UButton size="xs" variant="outline" block @click="refreshAllInsights">
        Geistesblitzpunkte auffrischen
      </UButton>
      <p class="text-[10px] text-ink-300 mt-1">
        GBP regenerieren am Anfang jedes Abenteuers.
      </p>
    </SheetSection>

    <SheetSection
      v-for="talent in HTBAH_TALENTS"
      :key="talent"
      :title="HTBAH_TALENT_LABELS[talent]"
      class="lg:col-span-1"
    >
      <div class="grid grid-cols-2 gap-2 items-end">
        <div class="stat-block px-2 py-2 text-center">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">Begabungswert</div>
          <div class="font-serif text-3xl">{{ htbahTalentValue(sheet, talent) }}</div>
          <div class="text-[10px] text-ink-300">aus Skill-Punkten</div>
        </div>
        <div class="stat-block px-2 py-2 text-center">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">Geistesblitze</div>
          <div class="font-serif text-2xl">
            {{ sheet.talents[talent].insightCurrent }}/{{ htbahInsightMax(sheet, talent) }}
          </div>
        </div>
      </div>
      <UFormField label="GBP aktuell" class="mt-2">
        <UInput
          type="number"
          :model-value="sheet.talents[talent].insightCurrent"
          @update:model-value="setInsightCurrent(talent, Number($event))"
        />
      </UFormField>

      <div class="accent-rule my-3" />
      <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">Fähigkeiten</div>
      <div class="hidden sm:grid grid-cols-12 gap-1 text-[10px] text-ink-300 px-1 mb-1">
        <div class="col-span-4">Name</div>
        <div class="col-span-2 text-center">Punkte</div>
        <div class="col-span-1 text-center">+Beg.</div>
        <div
          class="col-span-2 text-center"
          title="Allgemeiner Modifikator. Wird immer zur Probe addiert (Vor- oder Nachteil aus Eigenschaften, Wunden o.Ä.)."
        >Mod</div>
        <div class="col-span-2 text-center">Total</div>
        <div class="col-span-1"></div>
      </div>
      <div class="space-y-2">
        <div
          v-for="entry in skillsByTalent[talent]"
          :key="entry.skill.id"
          class="space-y-1"
        >
          <div class="grid grid-cols-12 gap-1 items-center">
            <UInput
              class="col-span-4"
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
              {{ htbahTalentValue(sheet, talent) }}
            </div>
            <UInput
              type="number"
              class="col-span-2"
              :model-value="entry.skill.modifier"
              placeholder="±"
              @update:model-value="updateSkill(entry.idx, { modifier: Number($event) })"
            />
            <div
              class="col-span-2 text-center font-serif text-base"
              :class="(entry.skill.spentPoints + htbahTalentValue(sheet, talent)) > HTBAH_SKILL_CAP ? 'text-amber-700' : ''"
              :title="(entry.skill.spentPoints + htbahTalentValue(sheet, talent)) > HTBAH_SKILL_CAP ? 'Über Regelwerk-Richtwert von 100 — bewusst erlaubt' : ''"
            >
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
          <div class="grid grid-cols-12 gap-1 items-center">
            <div class="col-span-3 flex items-center gap-1">
              <UIcon name="i-lucide-sun" class="size-3.5 text-amber-600 shrink-0" />
              <UInput
                size="xs"
                type="number"
                placeholder="Tag ±"
                :model-value="entry.skill.dayBonus"
                title="Bonus/Malus nur bei Tag (Morgen + Mittag) — wird automatisch zur Probe addiert, wenn die Karte tagsüber ist."
                @update:model-value="updateSkill(entry.idx, { dayBonus: Number($event) || 0 })"
              />
            </div>
            <div class="col-span-3 flex items-center gap-1">
              <UIcon name="i-lucide-moon" class="size-3.5 text-indigo-500 shrink-0" />
              <UInput
                size="xs"
                type="number"
                placeholder="Nacht ±"
                :model-value="entry.skill.nightBonus"
                title="Bonus/Malus nur bei Nacht (Abend + Nacht) — wird automatisch zur Probe addiert, wenn die Karte abends/nachts ist."
                @update:model-value="updateSkill(entry.idx, { nightBonus: Number($event) || 0 })"
              />
            </div>
            <UInput
              class="col-span-6"
              size="xs"
              placeholder="Notiz (z.B. Nachteil X reduziert um 10)"
              :model-value="entry.skill.note"
              @update:model-value="updateSkill(entry.idx, { note: String($event) })"
            />
          </div>
        </div>
      </div>
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" class="mt-2" @click="addSkill(talent)">
        Fähigkeit
      </UButton>
    </SheetSection>

    <SheetSection title="Vorteile (kosten Punkte)" class="lg:col-span-1">
      <div class="hidden sm:grid grid-cols-12 gap-1 text-[10px] text-ink-300 px-1 mb-1">
        <div class="col-span-7">Name</div>
        <div class="col-span-3 text-center">Kosten</div>
        <div class="col-span-2"></div>
      </div>
      <div class="space-y-2">
        <div
          v-for="(perk, idx) in sheet.advantages"
          :key="perk.id"
          class="space-y-1"
        >
          <div class="grid grid-cols-12 gap-1 items-center">
            <UInput
              class="col-span-7"
              placeholder="Name"
              :model-value="perk.name"
              @update:model-value="updatePerk('advantages', idx, { name: String($event) })"
            />
            <UInput
              type="number"
              class="col-span-3"
              :model-value="perk.cost"
              @update:model-value="updatePerk('advantages', idx, { cost: Number($event) })"
            />
            <UButton
              size="xs"
              color="error"
              variant="ghost"
              icon="i-lucide-x"
              class="col-span-2"
              @click="removePerk('advantages', idx)"
            />
          </div>
          <UInput
            placeholder="Notiz (optional)"
            :model-value="perk.note"
            @update:model-value="updatePerk('advantages', idx, { note: String($event) })"
          />
        </div>
      </div>
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" class="mt-2" @click="addPerk('advantages')">
        Vorteil
      </UButton>
      <p class="text-[10px] text-ink-300 mt-2">
        Kosten werden vom Pool abgezogen.
      </p>
    </SheetSection>

    <SheetSection title="Nachteile (bringen Punkte)" class="lg:col-span-1">
      <div class="hidden sm:grid grid-cols-12 gap-1 text-[10px] text-ink-300 px-1 mb-1">
        <div class="col-span-7">Name</div>
        <div class="col-span-3 text-center">Punkte</div>
        <div class="col-span-2"></div>
      </div>
      <div class="space-y-2">
        <div
          v-for="(perk, idx) in sheet.disadvantages"
          :key="perk.id"
          class="space-y-1"
        >
          <div class="grid grid-cols-12 gap-1 items-center">
            <UInput
              class="col-span-7"
              placeholder="Name"
              :model-value="perk.name"
              @update:model-value="updatePerk('disadvantages', idx, { name: String($event) })"
            />
            <UInput
              type="number"
              class="col-span-3"
              :model-value="perk.cost"
              @update:model-value="updatePerk('disadvantages', idx, { cost: Number($event) })"
            />
            <UButton
              size="xs"
              color="error"
              variant="ghost"
              icon="i-lucide-x"
              class="col-span-2"
              @click="removePerk('disadvantages', idx)"
            />
          </div>
          <UInput
            placeholder="Notiz (optional)"
            :model-value="perk.note"
            @update:model-value="updatePerk('disadvantages', idx, { note: String($event) })"
          />
        </div>
      </div>
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" class="mt-2" @click="addPerk('disadvantages')">
        Nachteil
      </UButton>
      <p class="text-[10px] text-ink-300 mt-2">
        Punkte werden auf den Pool addiert.
      </p>
    </SheetSection>

    <SheetSection title="Vorgeschichte" class="lg:col-span-1">
      <UFormField label="Bonus-Punkte">
        <UInput
          type="number"
          :model-value="sheet.backstory.points"
          @update:model-value="setBackstoryPoints(Number($event))"
        />
      </UFormField>
      <p class="text-[10px] text-ink-300 mt-1">
        Optional — werden zum Pool addiert.
      </p>
      <UFormField label="Text" class="mt-3">
        <UTextarea
          rows="9"
          placeholder="Herkunft, prägende Ereignisse, Motivation…"
          :model-value="sheet.backstory.text"
          class="w-full"
          @update:model-value="setBackstoryText(String($event))"
        />
      </UFormField>
    </SheetSection>

    <SheetSection title="Probe würfeln" class="lg:col-span-3">
      <div class="grid sm:grid-cols-12 gap-3 items-end">
        <UFormField label="Fähigkeit / Begabung" class="sm:col-span-6">
          <USelect
            v-model="probeTargetId"
            :items="probeOptions"
            value-key="value"
            placeholder="Was wird geprüft?"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Wurf (1–100)" class="sm:col-span-2">
          <UInput
            v-model.number="probeRoll"
            type="number"
            min="1"
            max="100"
            placeholder="—"
          />
        </UFormField>
        <UButton
          color="primary"
          icon="i-lucide-dices"
          class="sm:col-span-2"
          :disabled="!probeTargetId"
          @click="rollDice"
        >
          W100 würfeln
        </UButton>
        <UButton
          variant="ghost"
          icon="i-lucide-rotate-ccw"
          class="sm:col-span-2"
          :disabled="probeRoll === null"
          @click="resetProbe"
        >
          Zurücksetzen
        </UButton>
      </div>

      <div
        v-if="probeTarget && probeResult"
        :class="resultClass"
        class="mt-4 p-4 rounded-lg border-2 text-center transition"
      >
        <div class="flex items-center justify-center gap-3">
          <UIcon :name="resultIcon" class="size-8" />
          <div class="font-serif text-3xl">{{ resultText }}</div>
        </div>
        <div v-if="qualityText" class="font-serif text-lg mt-1">
          {{ qualityText }}
        </div>
        <div class="text-sm mt-2 opacity-90">
          <strong>{{ probeTarget.label }}</strong> · Zielwert {{ probeTarget.value }} · Wurf {{ probeRoll }}
        </div>
        <div class="text-xs mt-1 opacity-75">
          Krit-Erfolg ≤ {{ probeTarget.isTalentOnly ? '— (kein Krit bei reiner Begabungsprobe)' : htbahCritThreshold(probeTarget.value) }}
          ·
          Krit-Patzer ≥ {{ htbahFumbleThreshold(probeTarget.value) }}
        </div>
      </div>
      <p v-else class="text-xs text-ink-300 mt-3 text-center">
        Wähle eine Fähigkeit oder Begabung und gib das Würfelergebnis ein (oder klick auf <em>W100 würfeln</em>).
      </p>

      <!-- An Gruppe wuerfeln -->
      <div
        v-if="characterId && groupsForRoll.length"
        class="mt-4 pt-4 border-t border-parchment-700/20"
      >
        <div class="text-xs uppercase tracking-widest text-ink-300 mb-2">
          An Gruppen-Chat würfeln (Server würfelt, Ergebnis im Chat)
        </div>
        <div class="grid sm:grid-cols-12 gap-3 items-end">
          <UFormField label="Gruppe" class="sm:col-span-4">
            <USelect
              v-model="selectedGroupId"
              :items="groupOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Mod. (situativ)"
            class="sm:col-span-2"
            help="±10 = Erleichterung/Erschwernis"
          >
            <UInput
              v-model.number="rollModifier"
              type="number"
              min="-100"
              max="100"
            />
          </UFormField>
          <UFormField label="Notiz (optional)" class="sm:col-span-4">
            <UInput
              v-model="rollNote"
              placeholder="z.B. „klettert die Wand hoch"
              :maxlength="200"
            />
          </UFormField>
          <UButton
            color="primary"
            icon="i-lucide-send"
            class="sm:col-span-2"
            :disabled="!probeTargetId || !selectedGroupId"
            :loading="groupRollSending"
            @click="postRollToGroup"
          >
            An Gruppe
          </UButton>
        </div>
        <div v-if="groupRollError" class="text-xs text-red-700 mt-2">
          {{ groupRollError }}
        </div>
        <div v-if="groupRollSuccess" class="text-xs text-emerald-700 mt-2">
          ✓ Wurf an Gruppe gesendet.
        </div>
      </div>
      <p
        v-else-if="characterId && !groupsForRoll.length"
        class="text-[10px] text-ink-300 mt-3 text-center"
      >
        Du bist in keiner Gruppe — tritt einer Gruppe bei, um Würfe an einen Chat zu schicken.
      </p>
    </SheetSection>

    <SheetSection title="Ruestung & Waffen" class="lg:col-span-2">
      <!-- Ruestung: Summe wird beim Schadenswurf vom eingehenden Schaden abgezogen. -->
      <div class="space-y-2">
        <div class="flex items-baseline justify-between gap-2">
          <div class="text-xs uppercase tracking-widest text-ink-300">
            Ruestung
            <span class="text-[10px] normal-case tracking-normal text-ink-300/70">
              · Summe wird beim Schadenswurf abgezogen
            </span>
          </div>
          <div class="flex items-center gap-2">
            <span
              class="text-xs px-2 py-0.5 rounded font-mono font-semibold"
              :style="{
                background: totalArmor > 0 ? '#1e3a8a22' : 'transparent',
                color: totalArmor > 0 ? '#1e3a8a' : 'var(--color-ink-300)',
                border: totalArmor > 0 ? '1px solid #1e3a8a' : 'none',
              }"
              :title="'Gesamt-Ruestung: ' + totalArmor + ' HP'"
            >
              Σ {{ totalArmor }}
            </span>
            <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addArmor">
              Hinzufuegen
            </UButton>
          </div>
        </div>
        <p
          v-if="!(sheet.armor && sheet.armor.length)"
          class="text-xs text-ink-300 italic"
        >
          Noch keine Ruestung eingetragen.
        </p>
        <div
          v-for="(piece, idx) in (sheet.armor ?? [])"
          :key="piece.id"
          class="grid grid-cols-12 gap-2 items-center"
        >
          <UInput
            class="col-span-6"
            :model-value="piece.name"
            placeholder="z.B. Helm, Lederruestung, Schild"
            :maxlength="60"
            @update:model-value="updateArmor(idx, { name: String($event) })"
          />
          <UInput
            class="col-span-3"
            type="number"
            min="0"
            :model-value="piece.value"
            placeholder="Schutz"
            @update:model-value="updateArmor(idx, { value: Number($event) })"
          />
          <UInput
            class="col-span-2"
            :model-value="piece.note ?? ''"
            placeholder="Notiz"
            :maxlength="80"
            @update:model-value="updateArmor(idx, { note: String($event) })"
          />
          <UButton
            class="col-span-1"
            size="xs"
            variant="ghost"
            color="error"
            icon="i-lucide-x"
            @click="removeArmor(idx)"
          />
        </div>
      </div>

      <!-- Waffen: Name + Schadensformel (NdM±X). Werden im Mini-Charsheet
           direkt als Auswahl angeboten und fuellen den Schadenswurf. -->
      <div class="space-y-2 mt-4">
        <div class="flex items-baseline justify-between gap-2">
          <div class="text-xs uppercase tracking-widest text-ink-300">
            Waffen
            <span class="text-[10px] normal-case tracking-normal text-ink-300/70">
              · NdM±X (z.B. 4d10, 1d10+3)
            </span>
          </div>
          <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addWeapon">
            Hinzufuegen
          </UButton>
        </div>
        <p
          v-if="!(sheet.weapons && sheet.weapons.length)"
          class="text-xs text-ink-300 italic"
        >
          Noch keine Waffe eingetragen.
        </p>
        <div
          v-for="(w, idx) in (sheet.weapons ?? [])"
          :key="w.id"
          class="grid grid-cols-12 gap-2 items-center"
        >
          <UInput
            class="col-span-5"
            :model-value="w.name"
            placeholder="z.B. Kurzschwert"
            :maxlength="60"
            @update:model-value="updateWeapon(idx, { name: String($event) })"
          />
          <UInput
            class="col-span-3"
            :model-value="w.damageFormula"
            placeholder="4d10"
            :maxlength="20"
            @update:model-value="updateWeapon(idx, { damageFormula: String($event) })"
          />
          <UInput
            class="col-span-3"
            :model-value="w.note ?? ''"
            placeholder="Notiz"
            :maxlength="80"
            @update:model-value="updateWeapon(idx, { note: String($event) })"
          />
          <UButton
            class="col-span-1"
            size="xs"
            variant="ghost"
            color="error"
            icon="i-lucide-x"
            @click="removeWeapon(idx)"
          />
        </div>
      </div>
    </SheetSection>

    <!-- Zauber & Magie-Fähigkeiten: probt gegen einen vorhandenen Skill;
         jede Stufe modifiziert die Probe und liefert eine Schadensformel. -->
    <SheetSection title="Zauber & Magie" class="lg:col-span-2">
      <div class="flex items-baseline justify-between gap-2 mb-2">
        <p class="text-xs text-ink-300/80">
          Wähle pro Zauber einen Skill (Probe gegen dessen FW). Jede Stufe
          bekommt eine eigene Erschwernis und Schadensformel — im Battle-Map-Wurf
          kannst du die entsprechende Stufe wählen, beides wird automatisch befüllt.
        </p>
        <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addSpell">
          Zauber hinzufügen
        </UButton>
      </div>
      <p
        v-if="!(sheet.spells && sheet.spells.length)"
        class="text-xs text-ink-300 italic"
      >
        Noch kein Zauber eingetragen.
      </p>
      <div class="space-y-3">
        <div
          v-for="(spell, sIdx) in (sheet.spells ?? [])"
          :key="spell.id"
          class="border border-parchment-700/30 rounded p-2 bg-white/30 space-y-2"
        >
          <!-- Kopf: Name + Skill-Auswahl + Notiz + Löschen -->
          <div class="grid grid-cols-12 gap-2 items-center">
            <UInput
              class="col-span-4"
              :model-value="spell.name"
              placeholder="Zaubername (z.B. Feuerball)"
              :maxlength="60"
              @update:model-value="updateSpell(sIdx, { name: String($event) })"
            />
            <USelect
              class="col-span-4"
              :model-value="spell.skillId"
              :items="spellSkillOptions"
              value-key="value"
              size="sm"
              @update:model-value="updateSpell(sIdx, { skillId: String($event) })"
            />
            <UInput
              class="col-span-3"
              :model-value="spell.note ?? ''"
              placeholder="Notiz (optional)"
              :maxlength="120"
              @update:model-value="updateSpell(sIdx, { note: String($event) })"
            />
            <UButton
              class="col-span-1"
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              :title="`Zauber „${spell.name || '(unbenannt)'}“ löschen`"
              @click="removeSpell(sIdx)"
            />
          </div>

          <!-- Stufen-Liste -->
          <div class="pl-3 border-l-2 border-parchment-700/30 space-y-1">
            <div class="flex items-baseline justify-between">
              <div class="text-[10px] uppercase tracking-widest text-ink-300">
                Stufen
                <span class="normal-case tracking-normal text-ink-300/70">
                  · Mod typisch negativ (Erschwernis) · NdM±X für Schaden
                </span>
              </div>
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-plus"
                @click="addSpellLevel(sIdx)"
              >
                Stufe
              </UButton>
            </div>
            <p
              v-if="!spell.levels.length"
              class="text-xs text-ink-300 italic"
            >
              Noch keine Stufen — pro Stufe Erschwernis & Schaden anlegen.
            </p>
            <div
              v-for="(lvl, lIdx) in spell.levels"
              :key="lvl.id"
              class="grid grid-cols-12 gap-2 items-center"
            >
              <UInput
                class="col-span-3"
                :model-value="lvl.label"
                placeholder="z.B. Stufe 1 / Funke"
                :maxlength="40"
                @update:model-value="updateSpellLevel(sIdx, lIdx, { label: String($event) })"
              />
              <USelect
                class="col-span-2"
                :model-value="lvl.kind ?? 'damage'"
                :items="[
                  { label: '⚔ Schaden', value: 'damage' },
                  { label: '✚ Heilung', value: 'heal' },
                ]"
                value-key="value"
                size="sm"
                @update:model-value="updateSpellLevel(sIdx, lIdx, { kind: String($event) === 'heal' ? 'heal' : 'damage' })"
              />
              <UInput
                class="col-span-2"
                type="number"
                :model-value="lvl.modifier"
                placeholder="Mod ±"
                @update:model-value="updateSpellLevel(sIdx, lIdx, { modifier: Number($event) })"
              />
              <UInput
                class="col-span-2"
                :model-value="lvl.damageFormula"
                placeholder="z.B. 4d10"
                :maxlength="20"
                @update:model-value="updateSpellLevel(sIdx, lIdx, { damageFormula: String($event) })"
              />
              <UInput
                class="col-span-2"
                :model-value="lvl.note ?? ''"
                placeholder="Notiz"
                :maxlength="120"
                @update:model-value="updateSpellLevel(sIdx, lIdx, { note: String($event) })"
              />
              <UButton
                class="col-span-1"
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-x"
                @click="removeSpellLevel(sIdx, lIdx)"
              />
            </div>
          </div>
        </div>
      </div>
    </SheetSection>

    <!-- Verwendbare Gegenstände: Heiltrank, Erste-Hilfe-Paket o.aE. mit festem
         Heilwert + Anzahl. Im Battle-Map-Mini-Charsheet auf sich oder ein
         Ziel anwendbar — Anzahl sinkt automatisch um 1. -->
    <SheetSection title="Verwendbare Gegenstände" class="lg:col-span-2">
      <div class="flex items-baseline justify-between gap-2 mb-2">
        <p class="text-xs text-ink-300/80">
          Heiltrank, Erste-Hilfe-Paket o.ä. — Heilwert in HP plus Anzahl.
          Im Battle-Map-Mini-Charsheet wählst du ein Ziel + verwendest sie per Klick.
        </p>
        <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addUsableItem">
          Gegenstand
        </UButton>
      </div>
      <p
        v-if="!(sheet.usableItems && sheet.usableItems.length)"
        class="text-xs text-ink-300 italic"
      >
        Noch nichts eingetragen.
      </p>
      <div
        v-for="(item, idx) in (sheet.usableItems ?? [])"
        :key="item.id"
        class="grid grid-cols-12 gap-2 items-center"
      >
        <UInput
          class="col-span-5"
          :model-value="item.name"
          placeholder="z.B. Heiltrank, Erste-Hilfe-Paket"
          :maxlength="60"
          @update:model-value="updateUsableItem(idx, { name: String($event) })"
        />
        <UInput
          class="col-span-2"
          type="number"
          min="0"
          :model-value="item.healAmount"
          placeholder="Heilung"
          title="Heilwert in HP"
          @update:model-value="updateUsableItem(idx, { healAmount: Math.max(0, Math.floor(Number($event) || 0)) })"
        />
        <UInput
          class="col-span-2"
          type="number"
          min="0"
          :model-value="item.quantity"
          placeholder="Anzahl"
          title="Wie viele du davon dabei hast"
          @update:model-value="updateUsableItem(idx, { quantity: Math.max(0, Math.floor(Number($event) || 0)) })"
        />
        <UInput
          class="col-span-2"
          :model-value="item.note ?? ''"
          placeholder="Notiz"
          :maxlength="80"
          @update:model-value="updateUsableItem(idx, { note: String($event) })"
        />
        <UButton
          class="col-span-1"
          size="xs"
          variant="ghost"
          color="error"
          icon="i-lucide-x"
          @click="removeUsableItem(idx)"
        />
      </div>
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
      <div class="mt-3">
        <div class="flex items-baseline justify-between mb-1">
          <div class="text-xs uppercase tracking-widest text-ink-300">
            Geldbeutel
            <span class="text-[10px] normal-case tracking-normal text-ink-300/70">
              · 100 Kupfer = 1 Silber · 100 Silber = 1 Gold
            </span>
          </div>
          <UButton
            size="xs"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            title="Münzen umrechnen (100 Kupfer → 1 Silber, 100 Silber → 1 Gold)"
            @click="applyPurseNormalize"
          >
            Umrechnen
          </UButton>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <UFormField>
            <template #label>
              <span class="inline-flex items-center gap-1">
                <span class="inline-block w-2 h-2 rounded-full" style="background:#b45309" />
                Kupfer
              </span>
            </template>
            <UInput
              type="number"
              min="0"
              :model-value="sheet.purse.copper"
              @update:model-value="setPurseRaw('copper', Number($event))"
              @blur="applyPurseNormalize"
            />
          </UFormField>
          <UFormField>
            <template #label>
              <span class="inline-flex items-center gap-1">
                <span class="inline-block w-2 h-2 rounded-full" style="background:#9ca3af" />
                Silber
              </span>
            </template>
            <UInput
              type="number"
              min="0"
              :model-value="sheet.purse.silver"
              @update:model-value="setPurseRaw('silver', Number($event))"
              @blur="applyPurseNormalize"
            />
          </UFormField>
          <UFormField>
            <template #label>
              <span class="inline-flex items-center gap-1">
                <span class="inline-block w-2 h-2 rounded-full" style="background:#d4af37" />
                Gold
              </span>
            </template>
            <UInput
              type="number"
              min="0"
              :model-value="sheet.purse.gold"
              @update:model-value="setPurseRaw('gold', Number($event))"
              @blur="applyPurseNormalize"
            />
          </UFormField>
        </div>
      </div>
      <UFormField label="Sonstige Beute" class="mt-3" help="Edelsteine, Wertgegenstände, Schuldscheine — nicht-monetäre Beute.">
        <UTextarea
          rows="3"
          placeholder="z.B. Rubin (geschätzt 50 Gold), Goldkette, Schuldschein über 200 Silber …"
          :model-value="sheet.beute"
          class="w-full"
          @update:model-value="setText('beute', String($event))"
        />
      </UFormField>
    </SheetSection>

    <SheetSection title="Magie" class="lg:col-span-2">
      <UFormField
        label="Zauber, Foki, Mana, Sprüche"
        help="HtbaH hat keine festen Magie-Regeln — pflege Zauberlisten, magische Gegenstände und ggf. einen eigenen Mana-Pool hier frei."
      >
        <UTextarea
          rows="6"
          placeholder="z.B. Lichtball (1 Mana, Reichweite 10 m), Feuerstrahl (3 Mana, 2W10 Schaden) …"
          :model-value="sheet.magic"
          class="w-full"
          @update:model-value="setText('magic', String($event))"
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
