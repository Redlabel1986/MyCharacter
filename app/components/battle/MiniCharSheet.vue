<script setup lang="ts">
/**
 * Mini-Charakterbogen direkt in der Battle-Map.
 *
 * Akzeptiert eine LISTE von Tokens, die dem aktuellen User gehoeren.
 * Bei mehreren Tokens (z.B. der DM mit NPCs / Monstern) erscheinen Tabs zum
 * Wechseln. Pro Token wird gezeigt:
 *   - Charakter-gebunden (HtbaH / D&D 5e+2024 / DSA 5): Portrait, HP-Editor
 *     (sync zum Token), regelwerk-spezifischer Würfler (Skills, Saves,
 *     Eigenschafts-/Talent-/Zauber-Proben), Inventar
 *   - NPC ohne Charakter: HP-Editor + ggf. Beschreibungstext
 */
import {
  HTBAH_TALENTS,
  HTBAH_TALENT_LABELS,
  htbahSkillTotal,
  htbahTalentValue,
  type HtbahCharacterData,
  type HtbahTalent,
} from '~~/shared/engines/htbah'
import {
  DND_ABILITIES,
  DND_SKILLS,
  abilityModifier,
  saveBonus,
  skillBonus,
  type DnDAbility,
  type DnDCharacterData,
} from '~~/shared/engines/dnd'
import {
  DSA_ABILITIES,
  DSA_ABILITY_LABELS,
  type Dsa5CharacterData,
  type DsaAbility,
} from '~~/shared/engines/dsa5'
import type { GameSystem } from '~~/shared/systems'
import type { NpcAbility } from '~~/shared/npc'

interface Token {
  id: number
  ownerUserId: number
  characterId: number | null
  name: string
  imageUrl: string | null
  hp: number | null
  hpMax: number | null
  description: string
  system: 'htbah' | 'dnd' | 'dsa5' | null
  npcAbilities: NpcAbility[]
}

interface CharacterFull {
  id: number
  system: GameSystem
  name: string
  portraitUrl: string | null
  data: Record<string, unknown>
}

const props = defineProps<{
  groupId: number
  mapId: number
  tokens: Token[]
}>()

const emit = defineEmits<{
  (e: 'token-updated'): void
}>()

// Welcher Token ist gerade ausgewaehlt?
const selectedTokenId = ref<number | null>(null)
watch(
  () => props.tokens,
  (toks) => {
    if (!toks.length) {
      selectedTokenId.value = null
      return
    }
    // Wenn aktuell ausgewaehlter weg ist → ersten nehmen.
    if (
      selectedTokenId.value === null ||
      !toks.some((t) => t.id === selectedTokenId.value)
    ) {
      const withChar = toks.find((t) => t.characterId !== null)
      selectedTokenId.value = (withChar ?? toks[0]!).id
    }
  },
  { immediate: true, deep: true },
)

const activeToken = computed<Token | null>(() =>
  props.tokens.find((t) => t.id === selectedTokenId.value) ?? null,
)

// Charakter laden, wenn das aktive Token einen hat
const character = ref<CharacterFull | null>(null)
const characterLoading = ref(false)
const characterError = ref<string | null>(null)
const cacheByCharId = new Map<number, CharacterFull>()

const fetchChar = async (id: number) => {
  if (cacheByCharId.has(id)) {
    character.value = cacheByCharId.get(id)!
    return
  }
  characterLoading.value = true
  characterError.value = null
  try {
    const res = await $fetch<{ character: CharacterFull }>(`/api/characters/${id}`)
    character.value = res.character
    cacheByCharId.set(id, res.character)
  } catch (e: unknown) {
    characterError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Charakter nicht ladbar.'
    character.value = null
  } finally {
    characterLoading.value = false
  }
}

watch(
  () => activeToken.value?.characterId ?? null,
  (id) => {
    if (id) fetchChar(id)
    else {
      character.value = null
      characterError.value = null
    }
  },
  { immediate: true },
)

const isHtbah = computed(() => character.value?.system === 'htbah')
const isDnd = computed(
  () => character.value?.system === 'dnd5e' || character.value?.system === 'dnd2024',
)
const isDsa5 = computed(() => character.value?.system === 'dsa5')

const htbahData = computed<HtbahCharacterData | null>(() =>
  isHtbah.value && character.value ? (character.value.data as HtbahCharacterData) : null,
)
const dndData = computed<DnDCharacterData | null>(() =>
  isDnd.value && character.value ? (character.value.data as DnDCharacterData) : null,
)
const dsa5Data = computed<Dsa5CharacterData | null>(() =>
  isDsa5.value && character.value ? (character.value.data as Dsa5CharacterData) : null,
)

// — HP-Editor (immer aus aktiveem Token)
const hpDraft = ref<number | null>(null)
const hpMaxDraft = ref<number | null>(null)
watch(
  activeToken,
  (t) => {
    hpDraft.value = t?.hp ?? null
    hpMaxDraft.value = t?.hpMax ?? null
  },
  { immediate: true, deep: true },
)
const hpDirty = computed(
  () =>
    hpDraft.value !== (activeToken.value?.hp ?? null) ||
    hpMaxDraft.value !== (activeToken.value?.hpMax ?? null),
)
const hpSaving = ref(false)
const hpDelta = ref<number>(0)
const applyHpDelta = (sign: 1 | -1) => {
  if (hpDraft.value === null) return
  const change = sign * Math.abs(hpDelta.value || 0)
  hpDraft.value = Math.max(0, hpDraft.value + change)
  hpDelta.value = 0
  saveHp()
}
const saveHp = async () => {
  const t = activeToken.value
  if (!t) return
  hpSaving.value = true
  try {
    await $fetch(
      `/api/groups/${props.groupId}/maps/${props.mapId}/tokens/${t.id}`,
      {
        method: 'PUT',
        body: { hp: hpDraft.value, hpMax: hpMaxDraft.value },
      },
    )
    emit('token-updated')
  } catch (err) {
    console.error('HP-Update fehlgeschlagen', err)
  } finally {
    hpSaving.value = false
  }
}

// System-spezifische Wurf-Optionen.
type RollKind =
  | 'htbahSkill'
  | 'htbahTalent'
  | 'dndSkill'
  | 'dndSave'
  | 'dndAbility'
  | 'dsa5Skill'
  | 'dsa5Ability'
  | 'npcHtbah'
  | 'npcDnd'
  | 'npcDsa5'

interface RollTarget {
  kind: RollKind
  id: string
  label: string
  value: number | string
  source?: 'skill' | 'spell' | 'liturgy'
}

// NPC-Roller (Token ohne Charakter, mit eigenem Stat-Block)
const isNpcRoller = computed(() => {
  const t = activeToken.value
  return !!t && t.characterId === null && !!t.system && (t.npcAbilities?.length ?? 0) > 0
})
const isNpcDnd = computed(() => isNpcRoller.value && activeToken.value?.system === 'dnd')

const rollOptions = computed<RollTarget[]>(() => {
  if (htbahData.value) {
    const data = htbahData.value
    const items: RollTarget[] = []
    for (const t of HTBAH_TALENTS) {
      items.push({
        kind: 'htbahTalent',
        id: t,
        label: `${HTBAH_TALENT_LABELS[t]} (Begabung)`,
        value: htbahTalentValue(data, t),
      })
    }
    for (const s of data.skills) {
      if (!s.name?.trim()) continue
      items.push({
        kind: 'htbahSkill',
        id: s.id,
        label: `${s.name} — ${HTBAH_TALENT_LABELS[s.talent]}`,
        value: htbahSkillTotal(data, s),
      })
    }
    return items
  }
  if (dndData.value) {
    const data = dndData.value
    const items: RollTarget[] = []
    for (const a of DND_ABILITIES) {
      const m = abilityModifier(data.abilities[a].score)
      items.push({
        kind: 'dndAbility',
        id: a,
        label: `${a}-Probe`,
        value: m >= 0 ? `+${m}` : `${m}`,
      })
    }
    for (const a of DND_ABILITIES) {
      const m = saveBonus(data, a)
      items.push({
        kind: 'dndSave',
        id: a,
        label: `${a}-Rettungswurf`,
        value: m >= 0 ? `+${m}` : `${m}`,
      })
    }
    for (const s of DND_SKILLS) {
      const m = skillBonus(data, s.key).value
      items.push({
        kind: 'dndSkill',
        id: s.key,
        label: `${s.label} (${s.ability})`,
        value: m >= 0 ? `+${m}` : `${m}`,
      })
    }
    return items
  }
  if (dsa5Data.value) {
    const data = dsa5Data.value
    const items: RollTarget[] = []
    for (const a of DSA_ABILITIES) {
      items.push({
        kind: 'dsa5Ability',
        id: a,
        label: `${DSA_ABILITY_LABELS[a]} (Eigenschaft)`,
        value: data.abilities[a],
      })
    }
    for (const s of data.skills) {
      if (!s.name?.trim()) continue
      items.push({
        kind: 'dsa5Skill',
        id: s.id,
        source: 'skill',
        label: `${s.name} (${s.probe.join('/')})`,
        value: `FW ${s.fw ?? 0}`,
      })
    }
    for (const s of data.spells) {
      if (!s.name?.trim()) continue
      items.push({
        kind: 'dsa5Skill',
        id: s.id,
        source: 'spell',
        label: `Zauber: ${s.name} (${s.probe.join('/')})`,
        value: `ZfW ${s.zfw ?? 0}`,
      })
    }
    for (const s of data.liturgies) {
      if (!s.name?.trim()) continue
      items.push({
        kind: 'dsa5Skill',
        id: s.id,
        source: 'liturgy',
        label: `Liturgie: ${s.name} (${s.probe.join('/')})`,
        value: `LkW ${s.lkw ?? 0}`,
      })
    }
    return items
  }
  // NPC: Stat-Block aus dem Token, wenn kein Charakter gekoppelt ist.
  if (isNpcRoller.value && activeToken.value) {
    const items: RollTarget[] = []
    for (const a of activeToken.value.npcAbilities) {
      if (a.system === 'htbah') {
        items.push({ kind: 'npcHtbah', id: a.id, label: a.label || '(unbenannt)', value: a.value })
      } else if (a.system === 'dnd') {
        items.push({
          kind: 'npcDnd',
          id: a.id,
          label: a.label || '(unbenannt)',
          value: a.mod >= 0 ? `+${a.mod}` : `${a.mod}`,
        })
      } else {
        items.push({
          kind: 'npcDsa5',
          id: a.id,
          label: `${a.label || '(unbenannt)'} (${a.probe.join('/')})`,
          value: `FW ${a.fw}`,
        })
      }
    }
    return items
  }
  return []
})

const pickedRollId = ref<string>('')
const rollMod = ref<number>(0)
const rollNote = ref<string>('')
const rollDc = ref<number | null>(null)
const rollMode = ref<'normal' | 'advantage' | 'disadvantage'>('normal')

// Auswahl NUR beim echten Tab-Wechsel zuruecksetzen, nicht bei jedem 2s-Poll
// (sonst verliert der Spieler mitten im Wurf seine ausgewaehlte Probe).
watch(selectedTokenId, () => {
  pickedRollId.value = ''
  rollMod.value = 0
  rollNote.value = ''
  rollDc.value = null
  rollMode.value = 'normal'
})

const rollSending = ref(false)
const rollError = ref<string | null>(null)
const rollSuccess = ref(false)

const pickedRollOption = computed(() =>
  rollOptions.value.find((o) => `${o.kind}:${o.id}:${o.source ?? ''}` === pickedRollId.value)
    ?? null,
)

const rollIt = async () => {
  if (!pickedRollOption.value) return
  // Charakter-Wuerfe brauchen Charakter; NPC-Wuerfe brauchen einen NPC-Token.
  if (!character.value && !isNpcRoller.value) return
  rollSending.value = true
  rollError.value = null
  rollSuccess.value = false
  try {
    const opt = pickedRollOption.value
    const characterId = character.value?.id ?? 0
    const tokenId = activeToken.value?.id ?? 0
    const modifier = rollMod.value || undefined
    const note = rollNote.value.trim() || undefined
    const dc = rollDc.value || undefined
    const mode = rollMode.value
    let body: Record<string, unknown>
    switch (opt.kind) {
      case 'htbahSkill':
        body = { kind: 'htbahSkill', characterId, skillId: opt.id, modifier, note }
        break
      case 'htbahTalent':
        body = { kind: 'htbahTalent', characterId, talent: opt.id as HtbahTalent, modifier, note }
        break
      case 'dndSkill':
        body = {
          kind: 'dndSkill',
          characterId,
          skillKey: opt.id,
          modifier,
          dc,
          rollMode: mode === 'normal' ? undefined : mode,
          note,
        }
        break
      case 'dndSave':
        body = {
          kind: 'dndSave',
          characterId,
          ability: opt.id as DnDAbility,
          modifier,
          dc,
          rollMode: mode === 'normal' ? undefined : mode,
          note,
        }
        break
      case 'dndAbility':
        body = {
          kind: 'dndAbility',
          characterId,
          ability: opt.id as DnDAbility,
          modifier,
          dc,
          rollMode: mode === 'normal' ? undefined : mode,
          note,
        }
        break
      case 'dsa5Skill':
        body = {
          kind: 'dsa5Skill',
          characterId,
          skillId: opt.id,
          source: opt.source ?? 'skill',
          modifier,
          note,
        }
        break
      case 'dsa5Ability':
        body = {
          kind: 'dsa5Ability',
          characterId,
          ability: opt.id as DsaAbility,
          modifier,
          note,
        }
        break
      case 'npcHtbah':
        body = { kind: 'npcHtbah', tokenId, abilityId: opt.id, modifier, note }
        break
      case 'npcDnd':
        body = {
          kind: 'npcDnd',
          tokenId,
          abilityId: opt.id,
          modifier,
          dc,
          rollMode: mode === 'normal' ? undefined : mode,
          note,
        }
        break
      case 'npcDsa5':
        body = { kind: 'npcDsa5', tokenId, abilityId: opt.id, modifier, note }
        break
    }
    await $fetch(`/api/groups/${props.groupId}/rolls`, { method: 'POST', body })
    rollSuccess.value = true
    rollNote.value = ''
    setTimeout(() => (rollSuccess.value = false), 2200)
  } catch (e: unknown) {
    rollError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Wurf fehlgeschlagen.'
  } finally {
    rollSending.value = false
  }
}

const supportsRoller = computed(
  () => isHtbah.value || isDnd.value || isDsa5.value || isNpcRoller.value,
)
const rollPanelTitle = computed(() => {
  if (isHtbah.value) return 'Probe würfeln (HtbaH)'
  if (isDnd.value) return 'Probe würfeln (D&D)'
  if (isDsa5.value) return 'Probe würfeln (DSA 5)'
  if (isNpcRoller.value) {
    const sys = activeToken.value?.system
    if (sys === 'htbah') return 'NPC-Probe (HtbaH)'
    if (sys === 'dnd') return 'NPC-Probe (D&D)'
    if (sys === 'dsa5') return 'NPC-Probe (DSA 5)'
  }
  return 'Probe würfeln'
})

const inventoryOpen = ref(false)
const inventoryText = computed(() => {
  if (htbahData.value) return htbahData.value.inventory ?? ''
  if (dndData.value) return dndData.value.equipment ?? ''
  if (dsa5Data.value) return dsa5Data.value.inventory ?? ''
  return ''
})

const hpPercent = computed(() => {
  const t = activeToken.value
  if (!t || !t.hpMax) return 0
  return Math.max(0, Math.min(100, Math.round(((t.hp ?? 0) / t.hpMax) * 100)))
})
const hpColor = computed(() => {
  const p = hpPercent.value
  if (p > 75) return '#10b981'
  if (p > 50) return '#84cc16'
  if (p > 25) return '#f59e0b'
  if (p > 0) return '#ef4444'
  return '#7f1d1d'
})

const failedImageTokenIds = ref(new Set<number>())
const tabImage = (t: Token): string | null => {
  if (failedImageTokenIds.value.has(t.id)) return null
  if (t.characterId) return `/api/portrait/${t.characterId}`
  if (t.imageUrl) return `/api/groups/${props.groupId}/maps/${props.mapId}/tokens/${t.id}/image`
  return null
}
const onImageError = (tokenId: number) => {
  failedImageTokenIds.value.add(tokenId)
}
</script>

<template>
  <div v-if="!tokens.length" class="parchment-card p-3 text-xs text-ink-300 italic">
    Setz deinen Charakter (oder einen NPC) als Token auf die Karte — danach erscheint hier dein Mini-Bogen.
  </div>
  <div v-else class="parchment-card p-3 space-y-3">
    <!-- Tab-Switcher (nur wenn mehrere Tokens) -->
    <div
      v-if="tokens.length > 1"
      class="flex flex-wrap gap-1 -mt-1 -mx-1 pb-1 border-b border-parchment-700/30"
    >
      <button
        v-for="t in tokens"
        :key="t.id"
        type="button"
        class="flex items-center gap-1 px-2 py-1 text-xs rounded border transition"
        :class="t.id === selectedTokenId
          ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-ink-700 font-semibold'
          : 'bg-white/40 border-parchment-700/30 text-ink-400 hover:bg-white/70'"
        @click="selectedTokenId = t.id"
      >
        <img
          v-if="tabImage(t)"
          :src="tabImage(t) ?? ''"
          :alt="t.name"
          class="w-5 h-5 rounded-full object-cover border border-[var(--color-accent)]/50"
          @error="onImageError(t.id)"
        >
        <UIcon v-else name="i-lucide-user" class="size-4 opacity-60" />
        <span class="max-w-[140px] truncate">{{ t.name }}</span>
        <span
          v-if="t.hp !== null && t.hpMax"
          class="text-[10px] tabular-nums opacity-70"
        >
          {{ t.hp }}/{{ t.hpMax }}
        </span>
      </button>
    </div>

    <!-- Loading-/Fehler-/Inhalt-Zustand -->
    <div v-if="characterLoading" class="text-xs text-ink-400 italic">
      Lade Charakter …
    </div>
    <div v-else-if="characterError" class="text-xs text-red-700">
      {{ characterError }}
    </div>
    <div v-else-if="activeToken" class="space-y-3">
      <!-- Header: Bild + Name + HP-Bar -->
      <div class="flex items-center gap-3">
        <img
          v-if="character?.portraitUrl && !failedImageTokenIds.has(activeToken.id)"
          :src="`/api/portrait/${character.id}`"
          :alt="character.name"
          class="w-12 h-12 rounded-full object-cover border border-[var(--color-accent)]"
          @error="onImageError(activeToken.id)"
        >
        <img
          v-else-if="activeToken.imageUrl && !failedImageTokenIds.has(activeToken.id)"
          :src="`/api/groups/${groupId}/maps/${mapId}/tokens/${activeToken.id}/image`"
          :alt="activeToken.name"
          class="w-12 h-12 rounded-full object-cover border border-[var(--color-accent)]"
          @error="onImageError(activeToken.id)"
        >
        <div
          v-else
          class="w-12 h-12 rounded-full border border-[var(--color-accent)] bg-white/40 flex items-center justify-center text-ink-400"
        >
          <UIcon name="i-lucide-user" class="size-6" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-serif text-lg truncate">
            {{ character?.name ?? activeToken.name }}
          </div>
          <div class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ character ? character.system.toUpperCase() : 'NPC / Token' }}
            <span v-if="activeToken.hp !== null && activeToken.hpMax">
              · {{ activeToken.hp }}/{{ activeToken.hpMax }} HP
            </span>
          </div>
          <div
            v-if="activeToken.hpMax"
            class="mt-1 h-2 rounded bg-black/15 overflow-hidden"
          >
            <div
              class="h-full transition-all"
              :style="{ width: hpPercent + '%', background: hpColor }"
            />
          </div>
        </div>
      </div>

      <!-- HP-Editor -->
      <div class="flex flex-wrap items-end gap-2 text-xs">
        <UFormField label="HP">
          <UInput v-model.number="hpDraft" type="number" size="xs" class="w-20" />
        </UFormField>
        <UFormField label="Max">
          <UInput v-model.number="hpMaxDraft" type="number" size="xs" class="w-20" />
        </UFormField>
        <UButton
          v-if="hpDirty"
          size="xs"
          color="primary"
          :loading="hpSaving"
          @click="saveHp"
        >
          HP speichern
        </UButton>
        <span class="flex-1" />
        <UFormField label="±">
          <UInput v-model.number="hpDelta" type="number" size="xs" class="w-16" />
        </UFormField>
        <UButton size="xs" variant="outline" color="error" icon="i-lucide-minus" @click="applyHpDelta(-1)">
          Schaden
        </UButton>
        <UButton size="xs" variant="outline" color="success" icon="i-lucide-plus" @click="applyHpDelta(1)">
          Heilung
        </UButton>
      </div>

      <!-- Skill-/Begabungs-Würfler (HtbaH, D&D 5e/2024, DSA 5) -->
      <div v-if="supportsRoller" class="space-y-2">
        <div class="text-[10px] uppercase tracking-widest text-ink-300">{{ rollPanelTitle }}</div>
        <UFormField label="Probe">
          <USelect
            v-model="pickedRollId"
            :items="rollOptions.map((o) => ({ label: `${o.label} (${o.value})`, value: `${o.kind}:${o.id}:${o.source ?? ''}` }))"
            value-key="value"
            placeholder="— Probe wählen —"
            size="sm"
            class="w-full"
          />
        </UFormField>
        <div v-if="isDnd || isNpcDnd" class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <UFormField label="Modus" class="sm:col-span-4">
            <USelect
              v-model="rollMode"
              :items="[
                { label: 'Normal', value: 'normal' },
                { label: 'Vorteil', value: 'advantage' },
                { label: 'Nachteil', value: 'disadvantage' },
              ]"
              value-key="value"
              size="sm"
            />
          </UFormField>
          <UFormField label="DC (optional)" class="sm:col-span-4">
            <UInput v-model.number="rollDc" type="number" size="sm" placeholder="z.B. 15" />
          </UFormField>
          <UFormField label="Mod ±" class="sm:col-span-4">
            <UInput v-model.number="rollMod" type="number" size="sm" />
          </UFormField>
        </div>
        <div v-else class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <UFormField
            label="Mod ±"
            class="sm:col-span-12"
            :help="isDsa5 ? 'Erleichterung (+) / Erschwernis (−) auf jede Eigenschaft' : 'z.B. −10 Erschwernis'"
          >
            <UInput v-model.number="rollMod" type="number" size="sm" class="w-full" />
          </UFormField>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <UFormField label="Notiz (optional)" class="sm:col-span-7">
            <UInput
              v-model="rollNote"
              placeholder="z.B. „klettert hoch“ oder „mit Anlauf“"
              size="sm"
              :maxlength="200"
              class="w-full"
            />
          </UFormField>
          <UButton
            color="primary"
            icon="i-lucide-dices"
            :disabled="!pickedRollOption"
            :loading="rollSending"
            class="sm:col-span-5 roll-cta"
            size="lg"
            block
            @click="rollIt"
          >
            Würfeln
          </UButton>
        </div>
        <p v-if="rollError" class="text-xs text-red-700">{{ rollError }}</p>
        <p v-if="rollSuccess" class="text-xs text-emerald-700">✓ Wurf in Gruppen-Chat gepostet</p>
      </div>
      <div v-else-if="character" class="text-xs text-ink-300 italic">
        Für dieses Regelwerk ist (noch) kein Würfler eingebaut — der volle Bogen unten zeigt alle Werte.
      </div>

      <!-- Klappbares Inventar / Beschreibung -->
      <div>
        <button
          type="button"
          class="flex items-center gap-1 w-full text-left text-xs uppercase tracking-widest text-ink-400 hover:text-[var(--color-accent)]"
          @click="inventoryOpen = !inventoryOpen"
        >
          <UIcon :name="inventoryOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3" />
          {{ character ? 'Inventar' : 'Beschreibung' }}
        </button>
        <div
          v-if="inventoryOpen"
          class="mt-1 text-xs whitespace-pre-wrap bg-white/40 border border-parchment-700/20 rounded p-2 max-h-40 overflow-auto"
        >
          <span v-if="character && inventoryText.trim()">{{ inventoryText }}</span>
          <span v-else-if="!character && activeToken.description?.trim()">
            {{ activeToken.description }}
          </span>
          <span v-else class="italic text-ink-300">Leer.</span>
        </div>
      </div>

      <NuxtLink
        v-if="character"
        :to="`/characters/${character.id}`"
        class="block text-[10px] text-[var(--color-accent)] hover:underline"
        target="_blank"
      >
        Vollen Charakterbogen öffnen ↗
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped>
/* Wuerfeln-Button: prominenter, mit Akzent-Glow und groesserer Schrift. */
.roll-cta :deep(button) {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  box-shadow:
    0 0 0 1px var(--color-accent),
    0 0 12px 2px color-mix(in srgb, var(--color-accent) 50%, transparent);
  transition: box-shadow 120ms ease, transform 60ms ease;
}
.roll-cta :deep(button:hover:not(:disabled)) {
  box-shadow:
    0 0 0 1px var(--color-accent),
    0 0 18px 4px color-mix(in srgb, var(--color-accent) 70%, transparent);
}
.roll-cta :deep(button:active:not(:disabled)) {
  transform: translateY(1px);
}
</style>
