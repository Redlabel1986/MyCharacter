<script setup lang="ts">
import type { HtbahTalent } from '~~/shared/engines/htbah'
import { HTBAH_TALENT_LABELS, HTBAH_TALENTS } from '~~/shared/engines/htbah'

interface SkillEntry {
  id: string
  name: string
  talent: HtbahTalent
  visible: boolean
}
interface Share {
  userId: number
  username: string
  characterId: number | null
  hasPortrait: boolean
  characterName: string
  skills: SkillEntry[]
  showStory: boolean
  story: string | null
  storyText: string | null
}
interface SharesResponse {
  shares: Share[]
  currentUserId: number
}

const props = defineProps<{ groupId: number }>()
const emit = defineEmits<{ openShareModal: [] }>()

const shares = ref<Share[]>([])
const currentUserId = ref<number | null>(null)
const loading = ref(true)
const errorMsg = ref<string | null>(null)

const fetchShares = async () => {
  try {
    const res = await $fetch<SharesResponse>(`/api/groups/${props.groupId}/shares`)
    shares.value = res.shares
    currentUserId.value = res.currentUserId
    errorMsg.value = null
  } catch (e: unknown) {
    errorMsg.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Konnte Boegen nicht laden.'
  } finally {
    loading.value = false
  }
}

let pollHandle: ReturnType<typeof setInterval> | null = null
onMounted(async () => {
  await fetchShares()
  pollHandle = setInterval(fetchShares, 5000)
})
onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle)
})

defineExpose({ refresh: fetchShares })

const myShare = computed(() => shares.value.find((s) => s.userId === currentUserId.value) ?? null)
const otherShares = computed(() => shares.value.filter((s) => s.userId !== currentUserId.value))

const skillsByTalent = (skills: SkillEntry[], onlyVisible: boolean) => {
  const out: Record<HtbahTalent, SkillEntry[]> = { handeln: [], wissen: [], soziales: [] }
  for (const s of skills) {
    if (!onlyVisible || s.visible) out[s.talent].push(s)
  }
  return out
}

const portraitSrc = (s: Share) =>
  s.hasPortrait ? `/api/groups/${props.groupId}/shares/${s.userId}/portrait` : null

const updating = ref(false)
const persistMyShare = async (next: { skillIds: string[]; showStory: boolean }) => {
  if (!myShare.value || myShare.value.characterId === null) return
  updating.value = true
  // Optimistisch UI-State setzen, damit Klicks sofort wirken
  for (const skill of myShare.value.skills) {
    skill.visible = next.skillIds.includes(skill.id)
  }
  myShare.value.showStory = next.showStory
  myShare.value.story = next.showStory ? myShare.value.storyText : null
  try {
    await $fetch(`/api/groups/${props.groupId}/shares`, {
      method: 'PUT',
      body: {
        characterId: myShare.value.characterId,
        visibleSkillIds: next.skillIds,
        showStory: next.showStory,
      },
    })
    await fetchShares()
  } catch (e: unknown) {
    errorMsg.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Aktualisierung fehlgeschlagen.'
    await fetchShares()
  } finally {
    updating.value = false
  }
}

const toggleSkill = (skillId: string) => {
  if (!myShare.value || updating.value) return
  const current = myShare.value.skills.filter((s) => s.visible).map((s) => s.id)
  const next = current.includes(skillId)
    ? current.filter((id) => id !== skillId)
    : [...current, skillId]
  persistMyShare({ skillIds: next, showStory: myShare.value.showStory })
}

const toggleStory = () => {
  if (!myShare.value || updating.value) return
  const current = myShare.value.skills.filter((s) => s.visible).map((s) => s.id)
  persistMyShare({ skillIds: current, showStory: !myShare.value.showStory })
}

const removeMyShare = async () => {
  if (!confirm('Bogen aus der Gruppe entfernen?')) return
  updating.value = true
  try {
    await $fetch(`/api/groups/${props.groupId}/shares`, { method: 'DELETE' })
    await fetchShares()
  } finally {
    updating.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="loading" class="text-sm text-ink-300">Laedt …</div>
    <UAlert v-else-if="errorMsg" color="error" :title="errorMsg" />

    <!-- Eigene Karte (mit Inline-Edit) -->
    <div
      v-if="myShare"
      class="border border-parchment-700/30 rounded-md bg-parchment-100/40 p-3 space-y-3"
    >
      <div class="flex items-center gap-3">
        <div
          class="w-12 h-12 rounded-full overflow-hidden bg-parchment-700/10 border border-parchment-700/30 shrink-0"
        >
          <img
            v-if="portraitSrc(myShare)"
            :src="portraitSrc(myShare)!"
            :alt="myShare.characterName"
            class="w-full h-full object-cover"
          />
          <div
            v-else
            class="w-full h-full flex items-center justify-center text-ink-300 text-[9px]"
          >
            kein Bild
          </div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[10px] uppercase tracking-widest text-[var(--color-accent)]">
            Dein geteilter Bogen
          </div>
          <div class="font-serif text-sm truncate">{{ myShare.characterName }}</div>
        </div>
        <UButton
          size="xs"
          variant="ghost"
          color="error"
          icon="i-lucide-x"
          title="Bogen aus Gruppe entfernen"
          :disabled="updating"
          @click="removeMyShare"
        />
      </div>

      <div>
        <div class="text-[10px] uppercase tracking-widest text-ink-300 mb-1">
          Faehigkeiten (klicken zum Aus-/Einblenden)
        </div>
        <div class="space-y-2">
          <div v-for="talent in HTBAH_TALENTS" :key="talent">
            <div
              v-if="myShare.skills.filter((s) => s.talent === talent).length"
              class="text-[11px] font-semibold text-ink-400 mb-1"
            >
              {{ HTBAH_TALENT_LABELS[talent] }}
            </div>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="s in myShare.skills.filter((sk) => sk.talent === talent)"
                :key="s.id"
                type="button"
                class="px-2 py-0.5 rounded-full text-xs border transition"
                :class="s.visible
                  ? 'bg-[var(--color-accent-soft)] text-ink-700 border-[var(--color-accent)]/40'
                  : 'bg-transparent text-ink-300 border-parchment-700/30 hover:text-ink-500'"
                :disabled="updating"
                :title="s.visible ? 'Sichtbar — klick zum Verbergen' : 'Verborgen — klick zum Zeigen'"
                @click="toggleSkill(s.id)"
              >
                {{ s.name || '(unbenannt)' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between text-xs">
        <span class="text-ink-400">Hintergrundgeschichte</span>
        <UButton
          size="xs"
          :variant="myShare.showStory ? 'solid' : 'outline'"
          :color="myShare.showStory ? 'primary' : 'neutral'"
          :disabled="updating || !myShare.storyText"
          :title="!myShare.storyText ? 'Keine Story hinterlegt' : ''"
          @click="toggleStory"
        >
          {{ myShare.showStory ? 'sichtbar' : 'verborgen' }}
        </UButton>
      </div>
      <div
        v-if="myShare.showStory && myShare.storyText"
        class="text-xs text-ink-400 italic whitespace-pre-wrap border-l-2 border-parchment-700/30 pl-2 max-h-24 overflow-y-auto"
      >
        {{ myShare.storyText }}
      </div>
    </div>

    <!-- Wenn ich noch nichts geteilt habe -->
    <div
      v-else-if="!loading"
      class="border border-dashed border-parchment-700/40 rounded-md p-4 text-center"
    >
      <div class="text-xs text-ink-400 mb-2">Du hast noch keinen Bogen geteilt.</div>
      <UButton size="sm" variant="outline" icon="i-lucide-scroll-text" @click="emit('openShareModal')">
        Bogen teilen
      </UButton>
    </div>

    <UButton
      v-if="myShare"
      size="xs"
      variant="ghost"
      icon="i-lucide-replace"
      class="w-full"
      @click="emit('openShareModal')"
    >
      Anderen Charakter teilen
    </UButton>

    <div v-if="otherShares.length" class="accent-rule my-3" />

    <!-- Karten der anderen Spieler (read-only) -->
    <div
      v-for="s in otherShares"
      :key="s.userId"
      class="border border-parchment-700/30 rounded-md bg-white/40 p-3 space-y-2"
    >
      <div class="flex items-center gap-3">
        <div
          class="w-12 h-12 rounded-full overflow-hidden bg-parchment-700/10 border border-parchment-700/30 shrink-0"
        >
          <img
            v-if="portraitSrc(s)"
            :src="portraitSrc(s)!"
            :alt="s.characterName"
            class="w-full h-full object-cover"
          />
          <div
            v-else
            class="w-full h-full flex items-center justify-center text-ink-300 text-[9px]"
          >
            kein Bild
          </div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[10px] uppercase tracking-widest text-[var(--color-accent)]">
            {{ s.username }}
          </div>
          <div class="font-serif text-sm truncate">{{ s.characterName }}</div>
        </div>
      </div>

      <div v-if="s.skills.length">
        <div
          v-for="talent in HTBAH_TALENTS"
          :key="talent"
        >
          <div
            v-if="skillsByTalent(s.skills, true)[talent].length"
            class="text-xs"
          >
            <span class="font-semibold text-ink-500">
              {{ HTBAH_TALENT_LABELS[talent] }}:
            </span>
            <span class="text-ink-500">
              {{ skillsByTalent(s.skills, true)[talent].map((sk) => sk.name || '(unbenannt)').join(', ') }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="s.story" class="text-xs text-ink-500 whitespace-pre-wrap border-l-2 border-parchment-700/30 pl-2">
        {{ s.story }}
      </div>

      <div v-if="!s.skills.length && !s.story" class="text-xs text-ink-300 italic">
        Nichts freigegeben.
      </div>
    </div>

    <div v-if="!myShare && !otherShares.length && !loading" class="text-xs text-ink-300 text-center">
      In dieser Gruppe wurde noch kein Bogen geteilt.
    </div>
  </div>
</template>
