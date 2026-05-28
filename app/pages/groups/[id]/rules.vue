<script setup lang="ts">
/**
 * Regelbuch der Gruppe — vom DM gepflegte Hausregeln / Tischvereinbarungen.
 * Member sehen die Liste. Der DM (Gruppen-Owner) kann Regeln anlegen,
 * bearbeiten, loeschen und per Up/Down umsortieren.
 *
 * Bewusst KEIN Markdown-Render: Content wird als Plain-Text mit
 * `whitespace-pre-wrap` ausgegeben, damit DM-Eingaben kein HTML/JS in den
 * Player-Browser tragen koennen. Zeilenumbrueche reichen fuer Hausregeln.
 */

definePageMeta({ middleware: ['auth'] })

interface Rule {
  id: number
  groupId: number
  title: string
  content: string
  orderIdx: number
  createdAt: string
  updatedAt: string
}

const route = useRoute()
const groupId = Number(route.params.id)

const { data, pending, refresh } = await useFetch<{ rules: Rule[]; isOwner: boolean }>(
  `/api/groups/${groupId}/rules`,
  { default: () => ({ rules: [], isOwner: false }) },
)

const isOwner = computed(() => data.value?.isOwner ?? false)
const rules = computed<Rule[]>(() => data.value?.rules ?? [])

// — Neue Regel —
const newTitle = ref('')
const newContent = ref('')
const adding = ref(false)
const addError = ref<string | null>(null)

const addRule = async () => {
  if (!newTitle.value.trim()) return
  adding.value = true
  addError.value = null
  try {
    await $fetch(`/api/groups/${groupId}/rules`, {
      method: 'POST',
      body: { title: newTitle.value.trim(), content: newContent.value },
    })
    newTitle.value = ''
    newContent.value = ''
    await refresh()
  } catch (e: unknown) {
    addError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Konnte Regel nicht anlegen.'
  } finally {
    adding.value = false
  }
}

// — Inline-Edit —
const editingId = ref<number | null>(null)
const editTitle = ref('')
const editContent = ref('')
const editSaving = ref(false)
const editError = ref<string | null>(null)

const startEdit = (r: Rule) => {
  editingId.value = r.id
  editTitle.value = r.title
  editContent.value = r.content
  editError.value = null
}
const cancelEdit = () => {
  editingId.value = null
  editError.value = null
}
const saveEdit = async () => {
  if (editingId.value === null || !editTitle.value.trim()) return
  editSaving.value = true
  editError.value = null
  try {
    await $fetch(`/api/groups/${groupId}/rules/${editingId.value}`, {
      method: 'PUT',
      body: { title: editTitle.value.trim(), content: editContent.value },
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

const deleteRule = async (r: Rule) => {
  if (!confirm(`Regel "${r.title}" wirklich loeschen?`)) return
  try {
    await $fetch(`/api/groups/${groupId}/rules/${r.id}`, { method: 'DELETE' })
    if (editingId.value === r.id) editingId.value = null
    await refresh()
  } catch (e: unknown) {
    alert(
      (e as { statusMessage?: string }).statusMessage ?? 'Loeschen fehlgeschlagen.',
    )
  }
}

// — Reihenfolge per Up/Down: tauscht orderIdx mit dem Nachbarn —
const moveRule = async (idx: number, dir: -1 | 1) => {
  const list = rules.value
  const a = list[idx]
  const b = list[idx + dir]
  if (!a || !b) return
  try {
    // Zwei PUTs parallel — orderIdx-Konflikte gibt es nicht (kein UNIQUE).
    await Promise.all([
      $fetch(`/api/groups/${groupId}/rules/${a.id}`, {
        method: 'PUT',
        body: { orderIdx: b.orderIdx },
      }),
      $fetch(`/api/groups/${groupId}/rules/${b.id}`, {
        method: 'PUT',
        body: { orderIdx: a.orderIdx },
      }),
    ])
    await refresh()
  } catch (e: unknown) {
    alert(
      (e as { statusMessage?: string }).statusMessage ?? 'Umsortieren fehlgeschlagen.',
    )
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <NuxtLink
          :to="`/groups/${groupId}`"
          class="text-xs text-ink-400 hover:text-[var(--color-accent)]"
        >
          ← Zur Gruppe
        </NuxtLink>
        <h1 class="font-serif text-3xl flex items-center gap-2">
          <UIcon name="i-lucide-scroll-text" />
          Regelbuch
        </h1>
        <p class="text-sm text-ink-400 max-w-2xl">
          Hausregeln und Tischvereinbarungen der Gruppe.
          <template v-if="isOwner">
            Als DM kannst du Regeln anlegen, aendern, umsortieren und loeschen.
          </template>
          <template v-else>
            Nur der DM kann Regeln aendern — alle Mitspieler lesen mit.
          </template>
        </p>
      </div>
      <UButton size="sm" variant="ghost" icon="i-lucide-refresh-cw" @click="() => refresh()">
        Aktualisieren
      </UButton>
    </div>

    <div v-if="pending" class="text-ink-400">Lade …</div>

    <div
      v-else-if="!rules.length && !isOwner"
      class="parchment-card p-10 text-center"
    >
      <p class="font-serif text-xl">Noch keine Regeln aufgestellt.</p>
      <p class="text-ink-400 mt-2 text-sm">
        Der DM hat noch nichts ins Regelbuch geschrieben.
      </p>
    </div>

    <ol v-else-if="rules.length" class="space-y-4">
      <li
        v-for="(r, idx) in rules"
        :key="r.id"
        class="parchment-card p-4 space-y-2"
      >
        <!-- Edit-Modus -->
        <template v-if="isOwner && editingId === r.id">
          <UFormField label="Titel">
            <UInput v-model="editTitle" :maxlength="120" />
          </UFormField>
          <UFormField label="Regeltext">
            <UTextarea
              v-model="editContent"
              :rows="6"
              :maxlength="20000"
              placeholder="Was gilt am Tisch?"
            />
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
              :disabled="!editTitle.trim()"
              @click="saveEdit"
            >
              Speichern
            </UButton>
          </div>
        </template>

        <!-- Read-only / DM-Read-Modus -->
        <template v-else>
          <div class="flex items-start gap-3">
            <span
              class="font-serif text-2xl text-[var(--color-accent)] leading-none mt-0.5 shrink-0"
            >
              §{{ idx + 1 }}
            </span>
            <h2 class="font-serif text-xl flex-1 break-words">{{ r.title }}</h2>
            <div v-if="isOwner" class="flex items-center gap-1 shrink-0">
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-chevron-up"
                :disabled="idx === 0"
                title="Nach oben"
                @click="moveRule(idx, -1)"
              />
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-chevron-down"
                :disabled="idx === rules.length - 1"
                title="Nach unten"
                @click="moveRule(idx, 1)"
              />
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-pencil"
                title="Bearbeiten"
                @click="startEdit(r)"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                title="Loeschen"
                @click="deleteRule(r)"
              />
            </div>
          </div>
          <p
            v-if="r.content.trim()"
            class="text-sm whitespace-pre-wrap leading-relaxed"
          >
            {{ r.content }}
          </p>
          <p v-else class="text-xs text-ink-300 italic">
            (Kein Text)
          </p>
        </template>
      </li>
    </ol>

    <!-- Neue-Regel-Formular (nur DM) -->
    <section v-if="isOwner" class="parchment-card p-5 space-y-3">
      <h2 class="font-serif text-xl flex items-center gap-2">
        <UIcon name="i-lucide-plus-circle" />
        Neue Regel anlegen
      </h2>
      <div class="accent-rule" />
      <form class="space-y-3" @submit.prevent="addRule">
        <UFormField label="Titel" required>
          <UInput
            v-model="newTitle"
            placeholder="z.B. „Kritische Treffer verdoppeln nur den Wuerfel-Anteil“"
            :maxlength="120"
          />
        </UFormField>
        <UFormField label="Regeltext (optional)">
          <UTextarea
            v-model="newContent"
            :rows="5"
            :maxlength="20000"
            placeholder="Was gilt am Tisch? Zeilenumbrueche bleiben erhalten."
          />
        </UFormField>
        <UAlert v-if="addError" color="error" :title="addError" />
        <div class="flex justify-end">
          <UButton
            type="submit"
            color="primary"
            icon="i-lucide-plus"
            :loading="adding"
            :disabled="!newTitle.trim()"
          >
            Regel hinzufuegen
          </UButton>
        </div>
      </form>
    </section>
  </div>
</template>
