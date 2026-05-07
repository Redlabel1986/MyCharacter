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
  createBlankHtbah,
  type HtbahCharacterData,
  type HtbahTalent,
  type HtbahSkill,
  type HtbahPerk,
} from '~~/shared/engines/htbah'
import type { GameSystem } from '~~/shared/systems'
import SheetSection from '~/components/ui/SheetSection.vue'
import StatBlock from '~/components/ui/StatBlock.vue'

const props = defineProps<{ data: Record<string, unknown>; system: GameSystem }>()
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
    skills: incoming.skills ?? [],
    advantages: incoming.advantages ?? [],
    disadvantages: incoming.disadvantages ?? [],
    backstory: { ...blank.backstory, ...(incoming.backstory ?? {}) },
    inventory: incoming.inventory ?? '',
    beute: incoming.beute ?? '',
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
const setText = <K extends 'inventory' | 'notes' | 'beute'>(k: K, v: string) => {
  const n = clone(); n[k] = v; update(n)
}
const refreshAllInsights = () => {
  const n = clone()
  for (const t of HTBAH_TALENTS) {
    n.talents[t].insightCurrent = htbahInsightMax(n, t)
  }
  update(n)
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
        <UFormField label="Vorlieben" class="sm:col-span-3"><UInput :model-value="sheet.identity.likes" @update:model-value="setIdentity('likes', String($event))" /></UFormField>
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
        <div class="col-span-6">Name</div>
        <div class="col-span-2 text-center">Punkte</div>
        <div class="col-span-1 text-center">+Beg.</div>
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
            {{ htbahTalentValue(sheet, talent) }}
          </div>
          <div
            class="col-span-2 text-center font-serif text-base"
            :class="(entry.skill.spentPoints + htbahTalentValue(sheet, talent)) > HTBAH_SKILL_CAP ? 'text-red-700' : ''"
            :title="(entry.skill.spentPoints + htbahTalentValue(sheet, talent)) > HTBAH_SKILL_CAP ? 'Cap bei 100 — überschüssige Punkte umverteilen' : ''"
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
