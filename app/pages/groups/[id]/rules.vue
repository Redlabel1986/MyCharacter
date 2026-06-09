<script setup lang="ts">
/**
 * Regelbuch der Gruppe — Tabs (Paragraphenreiter) + Regeln pro Tab.
 *
 * Member sehen Tabs + Regeln. Der DM (Gruppen-Owner) kann zusaetzlich:
 *   - Tabs anlegen / umbenennen / loeschen (Loeschen kaskadiert Regeln)
 *   - Regeln pro Tab anlegen / bearbeiten / umsortieren / loeschen
 *
 * Such-Modus: Sobald die Suche nicht leer ist, zeigt die Seite Treffer aus
 * ALLEN Tabs als flache Liste mit Tab-Badge + §-Nummer. Der Tab-Reiter ist
 * dabei deaktiviert, damit klar ist, dass die Auswahl gerade nicht greift.
 *
 * Bewusst KEIN Markdown-Render: Content wird als Plain-Text mit
 * `whitespace-pre-wrap` ausgegeben, damit DM-Eingaben kein HTML/JS in den
 * Player-Browser tragen koennen.
 */

definePageMeta({ middleware: ['auth'] })

interface Tab {
  id: number
  groupId: number
  name: string
  orderIdx: number
}
interface Rule {
  id: number
  groupId: number
  tabId: number | null
  title: string
  content: string
  orderIdx: number
}

const route = useRoute()
const groupId = Number(route.params.id)

const { data, pending, refresh } = await useFetch<{
  tabs: Tab[]
  rules: Rule[]
  isOwner: boolean
}>(`/api/groups/${groupId}/rules`, {
  default: () => ({ tabs: [], rules: [], isOwner: false }),
})

const isOwner = computed(() => data.value?.isOwner ?? false)
const tabs = computed<Tab[]>(() => data.value?.tabs ?? [])
const allRules = computed<Rule[]>(() => data.value?.rules ?? [])

// — Aktiver Tab —
const activeTabId = ref<number | null>(null)
watch(
  tabs,
  (list) => {
    if (!list.length) {
      activeTabId.value = null
      return
    }
    if (activeTabId.value === null || !list.some((t) => t.id === activeTabId.value)) {
      activeTabId.value = list[0]!.id
    }
  },
  { immediate: true },
)
const activeTab = computed<Tab | null>(
  () => tabs.value.find((t) => t.id === activeTabId.value) ?? null,
)
const rulesInActiveTab = computed<Rule[]>(() =>
  allRules.value.filter((r) => r.tabId === activeTabId.value),
)

// — Suche —
const search = ref('')
const searchActive = computed(() => search.value.trim().length > 0)
const tabNameById = computed<Record<number, string>>(() => {
  const out: Record<number, string> = {}
  for (const t of tabs.value) out[t.id] = t.name
  return out
})
const rulesInTabIndexed = (rule: Rule): number => {
  // §-Nummer innerhalb des Tabs: Index der Regel in der Tab-Liste +1.
  const list = allRules.value.filter((r) => r.tabId === rule.tabId)
  return list.findIndex((r) => r.id === rule.id) + 1
}
const searchHits = computed<Rule[]>(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return []
  return allRules.value.filter(
    (r) =>
      r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q),
  )
})

// — Neue Regel —
const newTitle = ref('')
const newContent = ref('')
const adding = ref(false)
const addError = ref<string | null>(null)

const addRule = async () => {
  if (!newTitle.value.trim() || activeTabId.value === null) return
  adding.value = true
  addError.value = null
  try {
    await $fetch(`/api/groups/${groupId}/rules`, {
      method: 'POST',
      body: {
        tabId: activeTabId.value,
        title: newTitle.value.trim(),
        content: newContent.value,
      },
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

// — Inline-Edit Regel —
const editingId = ref<number | null>(null)
const editTitle = ref('')
const editContent = ref('')
const editTabId = ref<number | null>(null)
const editSaving = ref(false)
const editError = ref<string | null>(null)

const startEdit = (r: Rule) => {
  editingId.value = r.id
  editTitle.value = r.title
  editContent.value = r.content
  editTabId.value = r.tabId
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
      body: {
        title: editTitle.value.trim(),
        content: editContent.value,
        tabId: editTabId.value ?? undefined,
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

// — Reihenfolge per Up/Down: tauscht orderIdx mit dem Nachbarn IM SELBEN TAB —
const moveRule = async (idx: number, dir: -1 | 1) => {
  const list = rulesInActiveTab.value
  const a = list[idx]
  const b = list[idx + dir]
  if (!a || !b) return
  try {
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

// — Tab anlegen —
const newTabName = ref('')
const addingTab = ref(false)
const tabAddError = ref<string | null>(null)
const addTab = async () => {
  if (!newTabName.value.trim()) return
  addingTab.value = true
  tabAddError.value = null
  try {
    const res = await $fetch<{ tab: Tab }>(`/api/groups/${groupId}/rule-tabs`, {
      method: 'POST',
      body: { name: newTabName.value.trim() },
    })
    newTabName.value = ''
    await refresh()
    activeTabId.value = res.tab.id
  } catch (e: unknown) {
    tabAddError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Tab konnte nicht angelegt werden.'
  } finally {
    addingTab.value = false
  }
}

// — Tab umbenennen (inline) —
const renamingTabId = ref<number | null>(null)
const renameDraft = ref('')
const renameSaving = ref(false)
const startRenameTab = (t: Tab) => {
  renamingTabId.value = t.id
  renameDraft.value = t.name
}
const cancelRenameTab = () => {
  renamingTabId.value = null
}
const onRenameTabKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter') saveRenameTab()
  else if (e.key === 'Escape') cancelRenameTab()
}
const saveRenameTab = async () => {
  if (renamingTabId.value === null || !renameDraft.value.trim()) return
  renameSaving.value = true
  try {
    await $fetch(`/api/groups/${groupId}/rule-tabs/${renamingTabId.value}`, {
      method: 'PUT',
      body: { name: renameDraft.value.trim() },
    })
    renamingTabId.value = null
    await refresh()
  } catch (e: unknown) {
    alert(
      (e as { statusMessage?: string }).statusMessage ?? 'Umbenennen fehlgeschlagen.',
    )
  } finally {
    renameSaving.value = false
  }
}

// — Tab loeschen —
const deleteTab = async (t: Tab) => {
  const ruleCount = allRules.value.filter((r) => r.tabId === t.id).length
  const msg =
    ruleCount > 0
      ? `Tab "${t.name}" loeschen?\n\n${ruleCount} Regel${ruleCount === 1 ? '' : 'n'} darin werden mit geloescht.`
      : `Tab "${t.name}" loeschen?`
  if (!confirm(msg)) return
  try {
    await $fetch(`/api/groups/${groupId}/rule-tabs/${t.id}`, { method: 'DELETE' })
    if (activeTabId.value === t.id) activeTabId.value = null
    await refresh()
  } catch (e: unknown) {
    alert(
      (e as { statusMessage?: string }).statusMessage ?? 'Loeschen fehlgeschlagen.',
    )
  }
}

// — Tab umsortieren —
const moveTab = async (idx: number, dir: -1 | 1) => {
  const a = tabs.value[idx]
  const b = tabs.value[idx + dir]
  if (!a || !b) return
  try {
    await Promise.all([
      $fetch(`/api/groups/${groupId}/rule-tabs/${a.id}`, {
        method: 'PUT',
        body: { orderIdx: b.orderIdx },
      }),
      $fetch(`/api/groups/${groupId}/rule-tabs/${b.id}`, {
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

// — Search-Treffer anklicken: Suche leeren, Tab wechseln, sanft scrollen —
const jumpToRule = async (r: Rule) => {
  search.value = ''
  if (r.tabId !== null) activeTabId.value = r.tabId
  await nextTick()
  const el = document.getElementById(`rule-${r.id}`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ring-2', 'ring-[var(--color-accent)]')
    setTimeout(() => el.classList.remove('ring-2', 'ring-[var(--color-accent)]'), 1800)
  }
}

// — Tab-Optionen fuer Edit-Modus —
const tabOptions = computed(() =>
  tabs.value.map((t) => ({ label: t.name, value: t.id })),
)
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
          <UIcon name="i-lucide-scroll-text" />
          Regelbuch
        </h1>
        <p class="text-sm text-ink-400 max-w-2xl">
          Hausregeln und Tischvereinbarungen — in Paragraphenreiter sortiert.
          <template v-if="isOwner">
            Als DM kannst du Reiter und Regeln pflegen.
          </template>
          <template v-else>
            Nur der DM darf aendern — alle Mitspieler lesen mit.
          </template>
        </p>
      </div>
      <UButton size="sm" variant="ghost" icon="i-lucide-refresh-cw" @click="() => refresh()">
        Aktualisieren
      </UButton>
    </div>

    <!-- Suche (immer sichtbar) -->
    <UFormField label="Suche im Regelbuch">
      <UInput
        v-model="search"
        :placeholder="`Paragraphen durchsuchen — Titel oder Text …`"
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

    <!-- Such-Modus: Treffer aus allen Tabs -->
    <template v-else-if="searchActive">
      <p class="text-xs text-ink-300">
        {{ searchHits.length }}
        {{ searchHits.length === 1 ? 'Treffer' : 'Treffer' }}
        fuer „{{ search.trim() }}" in allen Reitern.
      </p>
      <div v-if="!searchHits.length" class="parchment-card p-8 text-center">
        <p class="font-serif text-lg">Kein Paragraph passt.</p>
        <p class="text-ink-400 mt-1 text-sm">
          Versuch ein anderes Stichwort oder leere die Suche fuer die Reiter-Ansicht.
        </p>
      </div>
      <ol v-else class="space-y-3">
        <li
          v-for="r in searchHits"
          :key="r.id"
          class="parchment-card p-4 space-y-2 text-left cursor-pointer hover:ring-2 hover:ring-[var(--color-accent)] transition"
          @click="jumpToRule(r)"
        >
          <div class="flex items-start gap-3">
            <span
              class="font-serif text-xl text-[var(--color-accent)] leading-none mt-0.5 shrink-0"
            >
              §{{ rulesInTabIndexed(r) }}
            </span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h2 class="font-serif text-lg break-words">{{ r.title }}</h2>
                <span
                  v-if="r.tabId !== null && tabNameById[r.tabId]"
                  class="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200"
                >
                  {{ tabNameById[r.tabId] }}
                </span>
              </div>
              <p
                v-if="r.content.trim()"
                class="text-sm whitespace-pre-wrap leading-relaxed text-ink-400 mt-1 line-clamp-3"
              >
                {{ r.content }}
              </p>
            </div>
          </div>
        </li>
      </ol>
    </template>

    <!-- Reiter-Modus -->
    <template v-else>
      <!-- Leere-Regelbuch-Karte: kein Tab vorhanden -->
      <div v-if="!tabs.length && !isOwner" class="parchment-card p-10 text-center">
        <p class="font-serif text-xl">Noch keine Regeln aufgestellt.</p>
        <p class="text-ink-400 mt-2 text-sm">
          Der DM hat noch keinen Reiter angelegt.
        </p>
      </div>
      <div v-else-if="!tabs.length && isOwner" class="parchment-card p-10 text-center space-y-3">
        <p class="font-serif text-xl">Lege deinen ersten Reiter an.</p>
        <p class="text-ink-400 text-sm">
          Reiter sind Kategorien — z.B. „Kampf", „Magie", „Hausregeln".
        </p>
        <form class="flex gap-2 max-w-md mx-auto" @submit.prevent="addTab">
          <UInput
            v-model="newTabName"
            placeholder="Reitername …"
            :maxlength="60"
            class="flex-1"
          />
          <UButton
            type="submit"
            color="primary"
            icon="i-lucide-plus"
            :loading="addingTab"
            :disabled="!newTabName.trim()"
          >
            Anlegen
          </UButton>
        </form>
        <p v-if="tabAddError" class="text-xs text-red-700">{{ tabAddError }}</p>
      </div>

      <!-- Tab-Bar -->
      <div v-if="tabs.length" class="flex items-center gap-1 flex-wrap border-b border-parchment-700/30 pb-1">
        <template v-for="(t, idx) in tabs" :key="t.id">
          <!-- Inline-Rename-Modus -->
          <div
            v-if="renamingTabId === t.id"
            class="flex items-center gap-1 bg-white/60 border border-[var(--color-accent)] rounded px-1 py-0.5"
          >
            <UInput
              v-model="renameDraft"
              size="xs"
              :maxlength="60"
              class="w-40"
              autofocus
              @keydown="onRenameTabKeydown"
            />
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-check"
              :loading="renameSaving"
              :disabled="!renameDraft.trim()"
              @click="saveRenameTab"
            />
            <UButton size="xs" variant="ghost" icon="i-lucide-x" @click="cancelRenameTab" />
          </div>
          <button
            v-else
            type="button"
            class="flex items-center gap-1 px-3 py-1.5 rounded-t font-serif text-sm transition"
            :class="
              activeTabId === t.id
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-b-0 border-parchment-700/40'
                : 'text-ink-400 hover:text-ink-500 hover:bg-white/40'
            "
            @click="activeTabId = t.id"
          >
            {{ t.name }}
            <span
              v-if="allRules.filter((r) => r.tabId === t.id).length"
              class="text-[10px] tabular-nums opacity-60"
            >
              ({{ allRules.filter((r) => r.tabId === t.id).length }})
            </span>
            <!-- DM-Tab-Tools direkt im Reiter, nur fuer aktiven Tab -->
            <template v-if="isOwner && activeTabId === t.id">
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-chevron-left"
                :disabled="idx === 0"
                title="Reiter nach links"
                @click.stop="moveTab(idx, -1)"
              />
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-chevron-right"
                :disabled="idx === tabs.length - 1"
                title="Reiter nach rechts"
                @click.stop="moveTab(idx, 1)"
              />
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-pencil"
                title="Reiter umbenennen"
                @click.stop="startRenameTab(t)"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                title="Reiter loeschen (inkl. Regeln)"
                @click.stop="deleteTab(t)"
              />
            </template>
          </button>
        </template>
        <!-- DM: neuer Tab inline -->
        <form
          v-if="isOwner"
          class="flex items-center gap-1 ms-auto"
          @submit.prevent="addTab"
        >
          <UInput
            v-model="newTabName"
            placeholder="Neuer Reiter …"
            size="xs"
            :maxlength="60"
            class="w-40"
          />
          <UButton
            type="submit"
            size="xs"
            variant="outline"
            icon="i-lucide-plus"
            :loading="addingTab"
            :disabled="!newTabName.trim()"
          >
            Reiter
          </UButton>
        </form>
      </div>
      <p v-if="tabAddError" class="text-xs text-red-700">{{ tabAddError }}</p>

      <!-- Regel-Liste im aktiven Tab -->
      <div v-if="activeTab" class="space-y-4">
        <div
          v-if="!rulesInActiveTab.length"
          class="parchment-card p-8 text-center"
        >
          <p class="font-serif text-lg">Noch keine Regeln in „{{ activeTab.name }}".</p>
          <p v-if="isOwner" class="text-ink-400 text-sm mt-1">
            Trag unten den ersten Paragraphen ein.
          </p>
        </div>

        <ol v-else class="space-y-3">
          <li
            v-for="(r, idx) in rulesInActiveTab"
            :key="r.id"
            :id="`rule-${r.id}`"
            class="parchment-card p-4 space-y-2 transition"
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
              <UFormField label="Reiter">
                <USelect
                  :model-value="editTabId ?? undefined"
                  :items="tabOptions"
                  value-key="value"
                  @update:model-value="(v) => editTabId = Number(v)"
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

            <!-- Read-Modus -->
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
                    :disabled="idx === rulesInActiveTab.length - 1"
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
              <p v-else class="text-xs text-ink-300 italic">(Kein Text)</p>
            </template>
          </li>
        </ol>

        <!-- Neue Regel im aktiven Tab (nur DM) -->
        <section v-if="isOwner" class="parchment-card p-5 space-y-3">
          <h2 class="font-serif text-xl flex items-center gap-2">
            <UIcon name="i-lucide-plus-circle" />
            Neue Regel in „{{ activeTab.name }}"
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
  </div>
</template>
