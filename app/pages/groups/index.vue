<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

interface GroupRow {
  id: number
  name: string
  ownerUserId: number
  createdAt: string
  memberCount: number
}

const { data, refresh, pending } = await useFetch<{ groups: GroupRow[] }>('/api/groups', {
  default: () => ({ groups: [] }),
})

const newName = ref('')
const creating = ref(false)
const error = ref<string | null>(null)

const create = async () => {
  if (!newName.value.trim()) return
  creating.value = true
  error.value = null
  try {
    const result = await $fetch<{ group: GroupRow }>('/api/groups', {
      method: 'POST',
      body: { name: newName.value.trim() },
    })
    newName.value = ''
    await navigateTo(`/groups/${result.group.id}`)
  } catch (e: unknown) {
    error.value = (e as { statusMessage?: string }).statusMessage ?? 'Konnte Gruppe nicht anlegen.'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="space-y-6 max-w-3xl mx-auto">
    <div>
      <h1 class="font-serif text-3xl">Gruppen</h1>
      <p class="text-sm text-ink-400">
        Bilde eine Spielgruppe mit deinen Mitspielern und dem DM, chatte in Echtzeit.
      </p>
    </div>

    <div class="parchment-card p-5 space-y-3">
      <h2 class="font-serif text-xl">Neue Gruppe</h2>
      <div class="accent-rule" />
      <form class="flex gap-2 items-end flex-wrap" @submit.prevent="create">
        <UFormField label="Name" class="flex-1 min-w-[14rem]">
          <UInput v-model="newName" placeholder="z.B. Aventurien-Runde" class="w-full" />
        </UFormField>
        <UButton type="submit" color="primary" :loading="creating">Gruppe anlegen</UButton>
      </form>
      <UAlert v-if="error" color="error" :title="error" />
    </div>

    <div v-if="pending" class="text-ink-400">Lade…</div>
    <div v-else-if="!data?.groups.length" class="parchment-card p-8 text-center">
      <p class="font-serif text-xl">Noch in keiner Gruppe.</p>
      <p class="text-ink-400 mt-2">Erstelle eine Gruppe oben oder lass dich von einem Owner einladen.</p>
    </div>
    <div v-else class="grid sm:grid-cols-2 gap-3">
      <NuxtLink
        v-for="g in data.groups"
        :key="g.id"
        :to="`/groups/${g.id}`"
        class="parchment-card hover-lift p-5 flex flex-col gap-1 hover:ring-2 hover:ring-[var(--color-accent)]"
      >
        <div class="font-serif text-xl">{{ g.name }}</div>
        <div class="text-xs text-ink-400">{{ g.memberCount }} Mitglieder</div>
      </NuxtLink>
    </div>
  </div>
</template>
