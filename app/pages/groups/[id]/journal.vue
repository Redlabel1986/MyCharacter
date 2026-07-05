<script setup lang="ts">
/**
 * Tagebuch / Chronik der Gruppe — kollaboratives Storyline-Logbuch.
 *
 * Anders als das Regelbuch (nur DM) darf hier JEDES Gruppenmitglied Eintraege
 * schreiben — „was alles passiert ist". Eintraege werden chronologisch
 * (aelteste zuerst) gezeigt, wie ein Logbuch das man von oben nach unten liest.
 *
 * Rechte:
 *   - Jeder darf neue Eintraege schreiben.
 *   - Eigene Eintraege darf der Autor bearbeiten/loeschen.
 *   - Der DM (Gruppen-Owner) darf moderierend jeden Eintrag bearbeiten/loeschen.
 *
 * Bewusst KEIN Markdown-Render: Content wird als Plain-Text mit
 * `whitespace-pre-wrap` ausgegeben, damit Eingaben kein HTML/JS in fremde
 * Browser tragen koennen.
 */

definePageMeta({ middleware: ['auth'] })

interface Entry {
  id: number
  groupId: number
  userId: number
  title: string
  entryDate: string
  content: string
  createdAt: string
  updatedAt: string
  author: { id: number; username: string }
}

const route = useRoute()
const groupId = Number(route.params.id)

const { data, pending, refresh } = await useFetch<{
  entries: Entry[]
  currentUserId: number
  isOwner: boolean
}>(`/api/groups/${groupId}/journal`, {
  default: () => ({ entries: [], currentUserId: 0, isOwner: false }),
})

const entries = computed<Entry[]>(() => data.value?.entries ?? [])
const currentUserId = computed(() => data.value?.currentUserId ?? 0)
const isOwner = computed(() => data.value?.isOwner ?? false)

const canEdit = (e: Entry) => e.userId === currentUserId.value || isOwner.value

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// — Suche —
const search = ref('')
const filteredEntries = computed<Entry[]>(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return entries.value
  return entries.value.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q) ||
      e.entryDate.toLowerCase().includes(q) ||
      e.author.username.toLowerCase().includes(q),
  )
})

// — Neuer Eintrag —
const newTitle = ref('')
const newEntryDate = ref('')
const newContent = ref('')
const adding = ref(false)
const addError = ref<string | null>(null)

const addEntry = async () => {
  if (!newTitle.value.trim() && !newContent.value.trim()) return
  adding.value = true
  addError.value = null
  try {
    await $fetch(`/api/groups/${groupId}/journal`, {
      method: 'POST',
      body: {
        title: newTitle.value.trim(),
        entryDate: newEntryDate.value.trim(),
        content: newContent.value,
      },
    })
    newTitle.value = ''
    newEntryDate.value = ''
    newContent.value = ''
    await refresh()
  } catch (e: unknown) {
    addError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Eintrag konnte nicht gespeichert werden.'
  } finally {
    adding.value = false
  }
}

// — Inline-Edit —
const editingId = ref<number | null>(null)
const editTitle = ref('')
const editEntryDate = ref('')
const editContent = ref('')
const editSaving = ref(false)
const editError = ref<string | null>(null)

const startEdit = (e: Entry) => {
  editingId.value = e.id
  editTitle.value = e.title
  editEntryDate.value = e.entryDate
  editContent.value = e.content
  editError.value = null
}
const cancelEdit = () => {
  editingId.value = null
  editError.value = null
}
const saveEdit = async () => {
  if (editingId.value === null) return
  if (!editTitle.value.trim() && !editContent.value.trim()) {
    editError.value = 'Eintrag braucht Titel oder Text.'
    return
  }
  editSaving.value = true
  editError.value = null
  try {
    await $fetch(`/api/groups/${groupId}/journal/${editingId.value}`, {
      method: 'PUT',
      body: {
        title: editTitle.value.trim(),
        entryDate: editEntryDate.value.trim(),
        content: editContent.value,
      },
    })
    editingId.value = null
    await refresh()
  } catch (e: unknown) {
    editError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Speichern fehlgeschlagen.'
  } finally {
    editSaving.value = false
  }
}

const deleteEntry = async (e: Entry) => {
  const label = e.title.trim() || 'diesen Eintrag'
  if (!confirm(`„${label}" wirklich loeschen?`)) return
  try {
    await $fetch(`/api/groups/${groupId}/journal/${e.id}`, { method: 'DELETE' })
    if (editingId.value === e.id) editingId.value = null
    await refresh()
  } catch (err: unknown) {
    alert(
      (err as { statusMessage?: string }).statusMessage ?? 'Loeschen fehlgeschlagen.',
    )
  }
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <NuxtLink
          :to="`/groups/${groupId}`"
          class="text-xs text-ink-400 hover:text-[var(--color-accent)]"
        >
          ← Zur Gruppe
        </NuxtLink>
        <h1 class="font-serif text-3xl flex items-center gap-2">
          <UIcon name="i-lucide-notebook-pen" />
          Tagebuch
        </h1>
        <p class="text-sm text-ink-400 max-w-2xl">
          Die Chronik eurer Abenteuer — haltet fest, was alles passiert ist.
          Jeder darf Eintraege schreiben; eigene Eintraege kannst du bearbeiten
          und loeschen.
        </p>
      </div>
      <UButton size="sm" variant="ghost" icon="i-lucide-refresh-cw" @click="() => refresh()">
        Aktualisieren
      </UButton>
    </div>

    <!-- Neuer Eintrag -->
    <section class="parchment-card p-5 space-y-3">
      <h2 class="font-serif text-xl flex items-center gap-2">
        <UIcon name="i-lucide-feather" />
        Neuer Eintrag
      </h2>
      <div class="accent-rule" />
      <form class="space-y-3" @submit.prevent="addEntry">
        <div class="grid gap-3 sm:grid-cols-3">
          <UFormField label="Titel" class="sm:col-span-2">
            <UInput
              v-model="newTitle"
              placeholder="z.B. „Der Ueberfall auf die Karawane“"
              :maxlength="200"
            />
          </UFormField>
          <UFormField label="Datum (im Spiel)">
            <UInput
              v-model="newEntryDate"
              placeholder="z.B. „3. Tag im Herbst“"
              :maxlength="120"
            />
          </UFormField>
        </div>
        <UFormField label="Was ist passiert?">
          <UTextarea
            v-model="newContent"
            :rows="6"
            :maxlength="50000"
            placeholder="Erzaehl, was am Tisch geschehen ist. Zeilenumbrueche bleiben erhalten."
            class="w-full"
          />
        </UFormField>
        <UAlert v-if="addError" color="error" :title="addError" />
        <div class="flex justify-end">
          <UButton
            type="submit"
            color="primary"
            icon="i-lucide-plus"
            :loading="adding"
            :disabled="!newTitle.trim() && !newContent.trim()"
          >
            Eintrag speichern
          </UButton>
        </div>
      </form>
    </section>

    <!-- Suche -->
    <UFormField v-if="entries.length" label="Im Tagebuch suchen">
      <UInput
        v-model="search"
        placeholder="Eintraege durchsuchen — Titel, Text, Datum oder Autor …"
        icon="i-lucide-search"
        :ui="{ trailing: 'pe-1' }"
      >
        <template v-if="search" #trailing>
          <UButton
            color="neutral"
            variant="link"
            size="sm"
            icon="i-lucide-x"
            aria-label="Suche leeren"
            @click="search = ''"
          />
        </template>
      </UInput>
    </UFormField>

    <div v-if="pending" class="text-ink-400">Lade …</div>

    <!-- Leeres Tagebuch -->
    <div
      v-else-if="!entries.length"
      class="parchment-card p-10 text-center"
    >
      <p class="font-serif text-xl">Das Tagebuch ist noch leer.</p>
      <p class="text-ink-400 mt-2 text-sm">
        Schreib oben den ersten Eintrag — wie hat euer Abenteuer begonnen?
      </p>
    </div>

    <!-- Keine Treffer -->
    <div
      v-else-if="!filteredEntries.length"
      class="parchment-card p-8 text-center"
    >
      <p class="font-serif text-lg">Kein Eintrag passt zu „{{ search.trim() }}".</p>
      <p class="text-ink-400 mt-1 text-sm">Versuch ein anderes Stichwort.</p>
    </div>

    <!-- Eintraege -->
    <ol v-else class="space-y-3">
      <li
        v-for="e in filteredEntries"
        :key="e.id"
        class="parchment-card p-4 space-y-2 transition"
      >
        <!-- Edit-Modus -->
        <template v-if="editingId === e.id">
          <div class="grid gap-3 sm:grid-cols-3">
            <UFormField label="Titel" class="sm:col-span-2">
              <UInput v-model="editTitle" :maxlength="200" />
            </UFormField>
            <UFormField label="Datum (im Spiel)">
              <UInput v-model="editEntryDate" :maxlength="120" />
            </UFormField>
          </div>
          <UFormField label="Was ist passiert?">
            <UTextarea v-model="editContent" :rows="6" :maxlength="50000" class="w-full" />
          </UFormField>
          <p v-if="editError" class="text-xs text-red-700">{{ editError }}</p>
          <div class="flex gap-2 justify-end">
            <UButton size="sm" variant="ghost" :disabled="editSaving" @click="cancelEdit">
              Abbrechen
            </UButton>
            <UButton
              size="sm"
              color="primary"
              icon="i-lucide-check"
              :loading="editSaving"
              @click="saveEdit"
            >
              Speichern
            </UButton>
          </div>
        </template>

        <!-- Read-Modus -->
        <template v-else>
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h2 v-if="e.title.trim()" class="font-serif text-xl break-words">
                  {{ e.title }}
                </h2>
                <span
                  v-if="e.entryDate.trim()"
                  class="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200"
                >
                  {{ e.entryDate }}
                </span>
              </div>
              <p class="text-[11px] text-ink-300 mt-0.5">
                <NuxtLink
                  :to="`/users/${e.author.id}`"
                  class="hover:underline"
                  title="Profil ansehen"
                >{{ e.author.username }}</NuxtLink>
                · {{ fmtDate(e.createdAt) }}
                <span v-if="e.updatedAt !== e.createdAt"> · bearbeitet</span>
              </p>
            </div>
            <div v-if="canEdit(e)" class="flex items-center gap-1 shrink-0">
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-pencil"
                title="Bearbeiten"
                @click="startEdit(e)"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                title="Loeschen"
                @click="deleteEntry(e)"
              />
            </div>
          </div>
          <p
            v-if="e.content.trim()"
            class="text-sm whitespace-pre-wrap leading-relaxed"
          >
            {{ e.content }}
          </p>
        </template>
      </li>
    </ol>
  </div>
</template>
