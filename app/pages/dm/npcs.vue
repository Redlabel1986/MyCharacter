<script setup lang="ts">
/**
 * NPC-Bibliothek des DM. Hier legt der DM Vorlagen an, die spaeter
 * auf der Battle-Map per Klick als Token platziert werden koennen.
 *
 * Scopes:
 *   - Privat (groupId = null): in allen eigenen Gruppen verfuegbar
 *   - Gruppe X (groupId = X): nur in dieser Kampagne sichtbar
 */
import NpcAbilitiesEditor from '~/components/battle/NpcAbilitiesEditor.vue'
import type { NpcAbility } from '~~/shared/npc'

definePageMeta({ middleware: ['dm'] })

interface NpcLibraryEntry {
  id: number
  ownerUserId: number
  groupId: number | null
  name: string
  system: 'htbah' | 'dnd' | 'dsa5' | null
  description: string
  defaultHp: number | null
  defaultHpMax: number | null
  defaultSizeMultiplier: number
  defaultVisionRadius: number
  defaultMoveRange: number
  imageUrl: string | null
  npcAbilities: NpcAbility[]
  createdAt: string
  updatedAt: string
}

interface GroupRow {
  id: number
  name: string
  ownerUserId: number
}

const { user } = useUserSession()

const { data: npcsData, refresh: refreshNpcs, pending: npcsLoading } =
  await useFetch<{ npcs: NpcLibraryEntry[] }>('/api/npcs', {
    default: () => ({ npcs: [] }),
  })

const { data: groupsData } = await useFetch<{ groups: GroupRow[] }>('/api/groups', {
  default: () => ({ groups: [] }),
})

const ownedGroups = computed<GroupRow[]>(() =>
  (groupsData.value?.groups ?? []).filter((g) => g.ownerUserId === user.value?.id),
)

const scopeFilter = ref<'all' | 'private' | number>('all')
const scopeOptions = computed(() => [
  { label: 'Alle anzeigen', value: 'all' as const },
  { label: 'DM-privat', value: 'private' as const },
  ...ownedGroups.value.map((g) => ({ label: `Gruppe: ${g.name}`, value: g.id })),
])

const filteredNpcs = computed<NpcLibraryEntry[]>(() => {
  const list = npcsData.value?.npcs ?? []
  if (scopeFilter.value === 'all') return list
  if (scopeFilter.value === 'private') return list.filter((n) => n.groupId === null)
  return list.filter((n) => n.groupId === scopeFilter.value)
})

const scopeLabel = (n: NpcLibraryEntry): string => {
  if (n.groupId === null) return 'Privat'
  const g = ownedGroups.value.find((x) => x.id === n.groupId)
  return g ? `Gruppe: ${g.name}` : `Gruppe #${n.groupId}`
}

const systemLabel = (s: NpcLibraryEntry['system']): string => {
  if (s === 'htbah') return 'HtbaH'
  if (s === 'dnd') return 'D&D'
  if (s === 'dsa5') return 'DSA 5'
  return '— ohne Wuerfler —'
}

const npcImageUrl = (n: NpcLibraryEntry) =>
  n.imageUrl ? `/api/npcs/${n.id}/image?v=${encodeURIComponent(n.updatedAt)}` : null

// --- Anlegen ---
const showCreateModal = ref(false)
const createDraft = ref({
  name: '',
  groupId: null as number | null,
  system: null as NpcLibraryEntry['system'],
  description: '',
  defaultHp: null as number | null,
  defaultHpMax: null as number | null,
  defaultSizeMultiplier: 1,
  defaultVisionRadius: 1,
  defaultMoveRange: 8,
  npcAbilities: [] as NpcAbility[],
  imageFile: null as File | null,
})
const createError = ref<string | null>(null)
const creating = ref(false)
const onCreateImageFile = (e: Event) => {
  const t = e.target as HTMLInputElement
  createDraft.value.imageFile = t.files?.[0] ?? null
}
const openCreate = () => {
  createDraft.value = {
    name: '',
    groupId: null,
    system: null,
    description: '',
    defaultHp: null,
    defaultHpMax: null,
    defaultSizeMultiplier: 1,
    defaultVisionRadius: 1,
    defaultMoveRange: 8,
    npcAbilities: [],
    imageFile: null,
  }
  createError.value = null
  showCreateModal.value = true
}
const submitCreate = async () => {
  const d = createDraft.value
  if (!d.name.trim()) {
    createError.value = 'Name fehlt.'
    return
  }
  creating.value = true
  createError.value = null
  try {
    const res = await $fetch<{ npc: NpcLibraryEntry }>('/api/npcs', {
      method: 'POST',
      body: {
        name: d.name.trim(),
        groupId: d.groupId,
        system: d.system,
        description: d.description.trim() || undefined,
        defaultHp: d.defaultHp,
        defaultHpMax: d.defaultHpMax,
        defaultSizeMultiplier: d.defaultSizeMultiplier,
        defaultVisionRadius: d.defaultVisionRadius,
        defaultMoveRange: d.defaultMoveRange,
        npcAbilities: d.npcAbilities,
      },
    })
    if (d.imageFile && res.npc) {
      const fd = new FormData()
      fd.append('file', d.imageFile)
      await $fetch(`/api/npcs/${res.npc.id}/image`, { method: 'POST', body: fd })
    }
    showCreateModal.value = false
    await refreshNpcs()
  } catch (e: unknown) {
    createError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Konnte NPC nicht anlegen.'
  } finally {
    creating.value = false
  }
}

// --- Bearbeiten ---
const editingId = ref<number | null>(null)
const editingDraft = ref<NpcLibraryEntry | null>(null)
const editingImageFile = ref<File | null>(null)
const editingError = ref<string | null>(null)
const editingSaving = ref(false)
const onEditImageFile = (e: Event) => {
  const t = e.target as HTMLInputElement
  editingImageFile.value = t.files?.[0] ?? null
}
const openEdit = (n: NpcLibraryEntry) => {
  editingId.value = n.id
  editingDraft.value = { ...n, npcAbilities: [...(n.npcAbilities ?? [])] }
  editingImageFile.value = null
  editingError.value = null
}
const closeEdit = () => {
  editingId.value = null
  editingDraft.value = null
  editingImageFile.value = null
  editingError.value = null
}
const submitEdit = async () => {
  const d = editingDraft.value
  if (!d) return
  if (!d.name.trim()) {
    editingError.value = 'Name fehlt.'
    return
  }
  editingSaving.value = true
  editingError.value = null
  try {
    await $fetch(`/api/npcs/${d.id}`, {
      method: 'PUT',
      body: {
        name: d.name.trim(),
        groupId: d.groupId,
        system: d.system,
        description: d.description,
        defaultHp: d.defaultHp,
        defaultHpMax: d.defaultHpMax,
        defaultSizeMultiplier: d.defaultSizeMultiplier,
        defaultVisionRadius: d.defaultVisionRadius,
        defaultMoveRange: d.defaultMoveRange,
        npcAbilities: d.npcAbilities,
      },
    })
    if (editingImageFile.value) {
      const fd = new FormData()
      fd.append('file', editingImageFile.value)
      await $fetch(`/api/npcs/${d.id}/image`, { method: 'POST', body: fd })
    }
    closeEdit()
    await refreshNpcs()
  } catch (e: unknown) {
    editingError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Speichern fehlgeschlagen.'
  } finally {
    editingSaving.value = false
  }
}

// --- Loeschen ---
const deleting = ref<number | null>(null)
const removeNpc = async (n: NpcLibraryEntry) => {
  if (!confirm(`NPC „${n.name}" aus der Bibliothek entfernen?`)) return
  deleting.value = n.id
  try {
    await $fetch(`/api/npcs/${n.id}`, { method: 'DELETE' })
    await refreshNpcs()
  } catch (e) {
    console.error('NPC loeschen fehlgeschlagen', e)
  } finally {
    deleting.value = null
  }
}

const scopeOptionsForForm = computed(() => [
  { label: 'DM-privat (alle eigenen Gruppen)', value: null },
  ...ownedGroups.value.map((g) => ({ label: `Gruppe: ${g.name}`, value: g.id })),
])
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <h1 class="font-serif text-3xl">NPC-Bibliothek</h1>
        <p class="text-sm text-ink-400 max-w-2xl">
          Lege NPC-Vorlagen mit Bild, Stat-Block, HP und Bewegungsfeld an. Auf der Battle-Map
          platzierst du sie spaeter mit einem Klick als Token. Privat = in allen deinen Gruppen
          verfuegbar; Gruppen-NPCs sind auf eine Kampagne beschraenkt.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UFormField label="Anzeigen">
          <USelect
            v-model="scopeFilter"
            :items="scopeOptions"
            value-key="value"
            size="sm"
            class="w-56"
          />
        </UFormField>
        <UButton color="primary" icon="i-lucide-plus" @click="openCreate">
          NPC hinzufuegen
        </UButton>
      </div>
    </div>

    <div v-if="npcsLoading" class="text-ink-400">Lade…</div>

    <div v-else-if="!filteredNpcs.length" class="parchment-card p-10 text-center">
      <p class="font-serif text-xl">Noch keine NPCs.</p>
      <p class="text-ink-400 mt-2">
        Klick auf „NPC hinzufuegen", um deinen ersten Goblin, Drachen oder NSC anzulegen.
      </p>
    </div>

    <div v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="n in filteredNpcs"
        :key="n.id"
        class="parchment-card p-4 flex gap-3"
      >
        <div class="w-20 h-20 rounded-full overflow-hidden bg-white/60 border border-[var(--color-accent)]/40 shrink-0 flex items-center justify-center">
          <img
            v-if="npcImageUrl(n)"
            :src="npcImageUrl(n) ?? ''"
            :alt="n.name"
            class="w-full h-full object-cover"
          >
          <UIcon v-else name="i-lucide-user" class="size-8 text-ink-300" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-2 flex-wrap">
            <div class="font-serif text-lg truncate flex-1">{{ n.name }}</div>
            <span
              class="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded font-semibold"
              :class="n.groupId === null
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800'"
            >
              {{ scopeLabel(n) }}
            </span>
          </div>
          <div class="text-[10px] uppercase tracking-widest text-ink-300 mt-0.5">
            {{ systemLabel(n.system) }}
            <template v-if="n.defaultHp !== null && n.defaultHpMax !== null">
              · {{ n.defaultHp }}/{{ n.defaultHpMax }} HP
            </template>
            · Bewegung {{ n.defaultMoveRange }}
            <template v-if="n.defaultSizeMultiplier > 1"> · Groesse {{ n.defaultSizeMultiplier }}</template>
          </div>
          <div v-if="n.description" class="text-xs text-ink-400 mt-1 line-clamp-2">
            {{ n.description }}
          </div>
          <div class="flex gap-2 mt-2">
            <UButton size="xs" variant="outline" icon="i-lucide-pencil" @click="openEdit(n)">
              Bearbeiten
            </UButton>
            <UButton
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              :loading="deleting === n.id"
              @click="removeNpc(n)"
            >
              Entfernen
            </UButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Anlegen-Modal -->
    <UModal v-model:open="showCreateModal" title="NPC anlegen">
      <template #body>
        <div class="space-y-3">
          <UFormField label="Name">
            <UInput v-model="createDraft.name" placeholder="z.B. Goblin-Wache" :maxlength="80" />
          </UFormField>
          <UFormField label="Scope" help="Privat = in allen deinen Gruppen. Gruppe X = nur in dieser Kampagne.">
            <USelect
              v-model="createDraft.groupId"
              :items="scopeOptionsForForm"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Beschreibung (Info-Karte, optional)">
            <UTextarea v-model="createDraft.description" :rows="3" :maxlength="4000" />
          </UFormField>
          <UFormField label="Bild (optional)" help="JPEG/PNG/WEBP, max 4 MB">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              class="block w-full text-sm"
              @change="onCreateImageFile"
            >
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="HP">
              <UInput v-model.number="createDraft.defaultHp" type="number" min="0" />
            </UFormField>
            <UFormField label="HP max">
              <UInput v-model.number="createDraft.defaultHpMax" type="number" min="0" />
            </UFormField>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <UFormField label="Groesse (Zellen)">
              <UInput v-model.number="createDraft.defaultSizeMultiplier" type="number" min="1" max="8" />
            </UFormField>
            <UFormField label="Sichtweite (Felder)">
              <UInput v-model.number="createDraft.defaultVisionRadius" type="number" min="0" max="60" />
            </UFormField>
            <UFormField label="Bewegungsfeld">
              <UInput v-model.number="createDraft.defaultMoveRange" type="number" min="0" max="200" />
            </UFormField>
          </div>
          <div class="border-t border-parchment-700/30 pt-3">
            <NpcAbilitiesEditor
              v-model:system="createDraft.system"
              v-model:abilities="createDraft.npcAbilities"
            />
          </div>
          <p v-if="createError" class="text-sm text-red-700">{{ createError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex gap-2 justify-end">
          <UButton variant="ghost" @click="showCreateModal = false">Abbrechen</UButton>
          <UButton color="primary" :loading="creating" @click="submitCreate">Anlegen</UButton>
        </div>
      </template>
    </UModal>

    <!-- Bearbeiten-Modal -->
    <UModal v-model:open="editingId" :title="editingDraft?.name ?? 'NPC'">
      <template #body>
        <div v-if="editingDraft" class="space-y-3">
          <UFormField label="Name">
            <UInput v-model="editingDraft.name" :maxlength="80" />
          </UFormField>
          <UFormField label="Scope">
            <USelect
              v-model="editingDraft.groupId"
              :items="scopeOptionsForForm"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Beschreibung (Info-Karte, optional)">
            <UTextarea v-model="editingDraft.description" :rows="3" :maxlength="4000" />
          </UFormField>
          <div v-if="editingDraft.imageUrl" class="flex items-center gap-3">
            <img
              :src="npcImageUrl(editingDraft) ?? ''"
              class="w-14 h-14 rounded-full object-cover border border-[var(--color-accent)]"
              alt=""
            >
            <span class="text-xs text-ink-400">Aktuelles Bild</span>
          </div>
          <UFormField label="Bild ersetzen (optional)" help="JPEG/PNG/WEBP, max 4 MB">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              class="block w-full text-sm"
              @change="onEditImageFile"
            >
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="HP">
              <UInput v-model.number="editingDraft.defaultHp" type="number" min="0" />
            </UFormField>
            <UFormField label="HP max">
              <UInput v-model.number="editingDraft.defaultHpMax" type="number" min="0" />
            </UFormField>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <UFormField label="Groesse (Zellen)">
              <UInput v-model.number="editingDraft.defaultSizeMultiplier" type="number" min="1" max="8" />
            </UFormField>
            <UFormField label="Sichtweite (Felder)">
              <UInput v-model.number="editingDraft.defaultVisionRadius" type="number" min="0" max="60" />
            </UFormField>
            <UFormField label="Bewegungsfeld">
              <UInput v-model.number="editingDraft.defaultMoveRange" type="number" min="0" max="200" />
            </UFormField>
          </div>
          <div class="border-t border-parchment-700/30 pt-3">
            <NpcAbilitiesEditor
              v-model:system="editingDraft.system"
              v-model:abilities="editingDraft.npcAbilities"
            />
          </div>
          <p v-if="editingError" class="text-sm text-red-700">{{ editingError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex gap-2 justify-end">
          <UButton variant="ghost" @click="closeEdit">Schliessen</UButton>
          <UButton color="primary" :loading="editingSaving" @click="submitEdit">Speichern</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
