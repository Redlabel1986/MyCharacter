/**
 * Initiative-Tracker der Battle-Map: Reihenfolge aufbauen (aus Token, NPCs,
 * manuell), SL-Wuerfelanfragen mit 1-Minuten-Countdown, Runden-/Zug-Navigation
 * (inkl. DoT-Tick beim Rundenwechsel) und Beenden.
 *
 * Aus [mapId].vue herausgeloest. Verhalten unveraendert. `initiativeState` lebt
 * jetzt hier (als zurueckgegebener Ref) und wird von fetchMap direkt befuellt;
 * Token-Liste/User/DM-Flag kommen als Refs herein, `fetchMap` und
 * `tokenImageSrc` als Callbacks.
 */
import type { Ref } from 'vue'

export interface InitiativeEntry {
  id: string
  name: string
  initiative: number
  characterId?: number
  ownerUserId?: number
  hasActed: boolean
  imageUrl?: string
}

export interface InitiativeState {
  active: boolean
  round: number
  currentIndex: number
  entries: InitiativeEntry[]
  /** Spieler-Charakter-IDs, von denen noch Init-Wuerfe ausstehen (SL-Anfrage). */
  awaitingFromCharacters?: number[]
}

/** Minimale Token-Form, die der Initiative-Tracker benoetigt. */
interface InitToken {
  id: number
  name: string
  characterId: number | null
  ownerUserId: number
  hidden: boolean
}

export function useBattleInitiative<T extends InitToken>(opts: {
  groupId: number
  mapId: number
  tokens: Ref<T[]>
  user: Ref<{ id: number } | null | undefined>
  isDm: Ref<boolean>
  fetchMap: () => Promise<void>
  tokenImageSrc: (t: T) => string | null | undefined
}) {
  const { groupId, mapId, tokens, user, isDm, fetchMap, tokenImageSrc } = opts

  const initiativeState = ref<InitiativeState | null>(null)

  // Tracking-Map fuer fehlgeschlagene Bild-Ladungen (alte Eintraege koennten
  // noch rohe private Blob-URLs enthalten, die der Browser nicht laden kann).
  // Bei `@error` wird die ID hier markiert und ein neutrales User-Icon
  // gerendert — das vermeidet das hässliche „broken image"-Glyph.
  const initEntryImageFailed = reactive<Record<string, boolean>>({})
  const initActive = computed(() => initiativeState.value?.active ?? false)
  const initEntries = computed<InitiativeEntry[]>(() => {
    const e = initiativeState.value?.entries ?? []
    return [...e].sort((a, b) => b.initiative - a.initiative)
  })
  const initCurrentEntryId = computed(() => {
    const s = initiativeState.value
    if (!s || !s.active) return null
    return initEntries.value[s.currentIndex]?.id ?? null
  })
  // Token-ID, das gerade an der Reihe ist (fuer das pulsierende Highlight auf der
  // Karte). Charakter-Eintraege ueber characterId, Token-Eintraege ueber die in
  // der Entry-ID kodierte Token-ID (`tok-<id>-...`). Manuelle Eintraege: kein Token.
  const currentTurnTokenId = computed<number | null>(() => {
    const id = initCurrentEntryId.value
    if (!id) return null
    const entry = initEntries.value.find((e) => e.id === id)
    if (!entry) return null
    if (entry.characterId != null) {
      const tok = tokens.value.find((t) => t.characterId === entry.characterId)
      if (tok) return tok.id
    }
    const m = /^tok-(\d+)-/.exec(entry.id)
    if (m) {
      const tid = Number(m[1])
      if (tokens.value.some((t) => t.id === tid)) return tid
    }
    return null
  })

  // Charaktere des eingeloggten Nutzers (Spieler ODER SL), die noch eine
  // Initiative-Anfrage offen haben — fuer den Schnell-Wurf-Button direkt im
  // Initiative-Panel (unabhaengig davon, welcher Token im Mini-Bogen gewaehlt ist).
  const myAwaitingChars = computed<{ characterId: number; name: string }[]>(() => {
    const awaiting = initiativeState.value?.awaitingFromCharacters ?? []
    if (!awaiting.length || !user.value) return []
    const myId = user.value.id
    const seen = new Set<number>()
    const out: { characterId: number; name: string }[] = []
    for (const t of tokens.value) {
      if (t.ownerUserId !== myId) continue
      if (t.characterId == null || !awaiting.includes(t.characterId)) continue
      if (seen.has(t.characterId)) continue
      seen.add(t.characterId)
      out.push({ characterId: t.characterId, name: t.name })
    }
    return out
  })
  const rollingCharId = ref<number | null>(null)
  const rollInitiativeFor = async (characterId: number) => {
    rollingCharId.value = characterId
    try {
      await $fetch(`/api/groups/${groupId}/initiative/roll`, {
        method: 'POST',
        body: { characterId },
      })
      await fetchMap()
    } catch (e: unknown) {
      alert((e as { statusMessage?: string }).statusMessage ?? 'Initiative-Wurf fehlgeschlagen.')
    } finally {
      rollingCharId.value = null
    }
  }

  const saveInitiative = async (state: InitiativeState | null) => {
    await $fetch(`/api/groups/${groupId}/initiative`, {
      method: 'PUT',
      body: state,
    })
    initiativeState.value = state
  }

  const initStartFromTokens = async () => {
    // Alle sichtbaren Token in den Tracker, Initiative = 10 (DM passt an)
    const entries: InitiativeEntry[] = tokens.value.map((t) => ({
      id: `tok-${t.id}-${Date.now()}`,
      name: t.name,
      initiative: 10,
      characterId: t.characterId ?? undefined,
      ownerUserId: t.ownerUserId,
      hasActed: false,
      imageUrl: tokenImageSrc(t) ?? undefined,
    }))
    await saveInitiative({
      active: true,
      round: 1,
      currentIndex: 0,
      entries,
    })
  }
  // Alle NPC-Token (ohne Charakter, nicht versteckt), die noch nicht in der
  // Reihenfolge stehen, hinzufuegen. Jeder NPC wuerfelt dabei 1W20 als Initiative
  // (der SL kann die Werte danach inline anpassen). Funktioniert auch bei bereits
  // gewuerfelter Spieler-Initiative.
  const initAddNpcs = async () => {
    const s = initiativeState.value
    if (!s) return
    const existingTokenIds = new Set<number>()
    for (const e of s.entries) {
      const m = /^tok-(\d+)-/.exec(e.id)
      if (m) existingTokenIds.add(Number(m[1]))
    }
    const npcTokens = tokens.value.filter(
      (t) => t.characterId === null && !t.hidden && !existingTokenIds.has(t.id),
    )
    if (!npcTokens.length) {
      alert('Keine weiteren sichtbaren NPC-Token auf der Karte, die noch nicht in der Reihenfolge stehen.')
      return
    }
    const stamp = Date.now()
    const newEntries: InitiativeEntry[] = npcTokens.map((t) => ({
      id: `tok-${t.id}-${stamp}`,
      name: t.name,
      // 1W20 pro NPC.
      initiative: Math.floor(Math.random() * 20) + 1,
      ownerUserId: t.ownerUserId,
      hasActed: false,
      imageUrl: tokenImageSrc(t) ?? undefined,
    }))
    await saveInitiative({ ...s, entries: [...s.entries, ...newEntries] })
  }
  const initAddManual = async () => {
    const name = prompt('Name fuer Initiative-Eintrag?')?.trim()
    if (!name) return
    const initRaw = prompt('Initiative (Zahl)?', '10')
    const initiative = Number.parseInt(initRaw ?? '10', 10) || 10
    const entries = [
      ...(initiativeState.value?.entries ?? []),
      {
        id: `manual-${Date.now()}`,
        name,
        initiative,
        hasActed: false,
      },
    ]
    await saveInitiative({
      active: initiativeState.value?.active ?? true,
      round: initiativeState.value?.round ?? 1,
      currentIndex: initiativeState.value?.currentIndex ?? 0,
      entries,
    })
  }
  const initRemoveEntry = async (id: string) => {
    if (!initiativeState.value) return
    const entries = initiativeState.value.entries.filter((e) => e.id !== id)
    await saveInitiative({ ...initiativeState.value, entries })
  }

  // --- Initiative-Anfrage (SL fordert Wuerfe an) ---
  // Sammelt ALLE Token mit Charakter-Bezug auf der Karte (Spieler UND SL-eigene
  // Charaktere/DMPCs) und legt deren characterId in `awaitingFromCharacters`. Im
  // MiniCharSheet erscheint dann pro Charakter ein roter "Initiative wuerfeln"-
  // Button, der server-seitig 1W10 + Handeln wuerfelt und das Ergebnis hier
  // eintraegt. NPC-Token (ohne Charakter) sind nicht dabei — die fuegt der SL
  // ueber „NPCs hinzufuegen" hinzu.
  const initRequestPlayerRolls = async () => {
    // Alle Token mit Charakter-Bezug — unabhaengig vom Besitzer, damit auch die
    // Charaktere des Spielleiters einen Wuerfel-Button bekommen. Mehrere Token
    // desselben Charakters werden deduppt (Set).
    const playerCharacterIds: number[] = Array.from(
      new Set<number>(
        tokens.value
          .filter((t) => t.characterId !== null)
          .map((t) => t.characterId as number),
      ),
    )
    if (!playerCharacterIds.length) {
      alert('Keine Charaktere auf der Karte. Lege erst Token mit Charakter-Bezug an.')
      return
    }
    const s = initiativeState.value
    await saveInitiative({
      active: s?.active ?? true,
      round: s?.round ?? 1,
      currentIndex: s?.currentIndex ?? 0,
      // Bisherige Spieler-Eintraege rauswerfen, NPCs/manuelle Eintraege behalten —
      // sonst hat man nach der zweiten Anfrage doppelte Eintraege.
      entries: (s?.entries ?? []).filter(
        (e) => !e.characterId || !playerCharacterIds.includes(e.characterId),
      ),
      awaitingFromCharacters: playerCharacterIds,
    })
    // 1-Minuten-Timer starten: wer bis dahin nicht gewuerfelt hat, wird beim
    // automatischen Beenden nicht in die Initiative uebernommen.
    initRequestDeadline.value = Date.now() + INIT_REQUEST_MS
  }
  // Anfrage beenden: bereits eingegangene Wuerfe bleiben, wer noch nicht
  // gewuerfelt hat (z.B. offline) wird einfach nicht uebernommen. Der Tracker
  // bleibt aktiv und laeuft mit den vorhandenen Eintraegen weiter.
  const initFinishRequest = async () => {
    const s = initiativeState.value
    if (!s) return
    initRequestDeadline.value = null
    await saveInitiative({ ...s, active: true, awaitingFromCharacters: undefined })
  }
  const initAwaitingCount = computed(
    () => initiativeState.value?.awaitingFromCharacters?.length ?? 0,
  )

  // --- 1-Minuten-Timer fuer die Initiative-Anfrage ---
  const INIT_REQUEST_MS = 60_000
  const initRequestDeadline = ref<number | null>(null)
  const nowTick = ref(Date.now())
  const initRequestSecondsLeft = computed(() => {
    if (initRequestDeadline.value === null) return null
    return Math.max(0, Math.ceil((initRequestDeadline.value - nowTick.value) / 1000))
  })
  const initCountdownLabel = computed(() => {
    const s = initRequestSecondsLeft.value
    if (s === null) return ''
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  })
  let initTimer: ReturnType<typeof setInterval> | null = null
  onMounted(() => {
    initTimer = setInterval(() => {
      nowTick.value = Date.now()
      // Deadline erreicht und noch offene Wuerfe → automatisch beenden (nur DM
      // schreibt; der DM treibt den Kampf, sein Client ist offen).
      if (
        isDm.value &&
        initRequestDeadline.value !== null &&
        nowTick.value >= initRequestDeadline.value &&
        initAwaitingCount.value > 0
      ) {
        initFinishRequest()
      }
    }, 1000)
  })
  onBeforeUnmount(() => {
    if (initTimer) clearInterval(initTimer)
  })
  // Deadline-Lebenszyklus an den Warte-Status koppeln: keine offenen Wuerfe mehr
  // → Timer aus. Anfrage aktiv (z.B. nach Reload), aber kein Deadline → frische
  // Minute, damit der Countdown weiterlaeuft.
  watch(
    initAwaitingCount,
    (n) => {
      if (n === 0) {
        initRequestDeadline.value = null
      } else if (initRequestDeadline.value === null) {
        initRequestDeadline.value = Date.now() + INIT_REQUEST_MS
      }
    },
    { immediate: true },
  )
  const initSetInitiative = async (id: string, value: number) => {
    if (!initiativeState.value) return
    const entries = initiativeState.value.entries.map((e) =>
      e.id === id ? { ...e, initiative: value } : e,
    )
    await saveInitiative({ ...initiativeState.value, entries })
  }
  const initNextTurn = async () => {
    const s = initiativeState.value
    if (!s || !s.entries.length) return
    // Sortierte Reihenfolge wie initEntries.value
    const sorted = initEntries.value
    const currentSortedIdx = sorted.findIndex((e) => e.id === initCurrentEntryId.value)
    const nextIdx = currentSortedIdx + 1
    if (nextIdx >= sorted.length) {
      // Neue Runde — vor dem Save: Schaden-ueber-Zeit-Tick auf alle Token mit
      // DoT-Zustaenden (Gift/Brennen/Bluten/Saeure/…) anwenden. Bluten ohne
      // Dauer bleibt kumulativ (Runde 1 −1, Runde 2 −2, …).
      try {
        await $fetch(`/api/groups/${groupId}/maps/${mapId}/tick-conditions`, {
          method: 'POST',
        })
      } catch {
        // Tick-Fehler sollen den Runden-Wechsel nicht blockieren.
      }
      const entries = s.entries.map((e) => ({ ...e, hasActed: false }))
      await saveInitiative({
        ...s,
        entries,
        round: s.round + 1,
        currentIndex: 0,
      })
      await fetchMap()
    } else {
      // Markiere aktuellen als hasActed
      const entries = s.entries.map((e) =>
        e.id === sorted[currentSortedIdx]?.id ? { ...e, hasActed: true } : e,
      )
      // currentIndex bezieht sich auf den entry in der sortierten Liste,
      // wir speichern aber den Index in der unsortierten state.entries.
      // Stattdessen: speichere ID des aktuellen Eintrags ueber currentIndex
      // Workaround: setze currentIndex auf nextIdx und sortiere immer beim Lesen
      await saveInitiative({ ...s, entries, currentIndex: nextIdx })
    }
  }
  const initPrevTurn = async () => {
    const s = initiativeState.value
    if (!s || !s.entries.length) return
    const sorted = initEntries.value
    const currentSortedIdx = sorted.findIndex((e) => e.id === initCurrentEntryId.value)
    const prevIdx = currentSortedIdx - 1
    if (prevIdx < 0) {
      // Vorherige Runde — falls round > 1
      if (s.round > 1) {
        // hasActed-Flags fuer alle aktivieren (sind ja durch)
        const entries = s.entries.map((e) => ({ ...e, hasActed: true }))
        await saveInitiative({
          ...s,
          entries,
          round: s.round - 1,
          currentIndex: Math.max(0, sorted.length - 1),
        })
      }
      return
    }
    // Bei Rückschritt im selben Round: hasActed auf dem vorherigen Eintrag
    // wieder zurücksetzen, damit man den Zug "nochmal" machen kann.
    const prevId = sorted[prevIdx]?.id
    const entries = s.entries.map((e) =>
      e.id === prevId ? { ...e, hasActed: false } : e,
    )
    await saveInitiative({ ...s, entries, currentIndex: prevIdx })
  }

  const initSetRound = async (round: number) => {
    const s = initiativeState.value
    if (!s) return
    const r = Math.max(1, Math.min(10000, Math.floor(round) || 1))
    await saveInitiative({ ...s, round: r })
  }

  const initResetRound = async () => {
    const s = initiativeState.value
    if (!s) return
    if (!confirm('Initiative zurücksetzen — Runde 1, alle wieder „nicht gezogen"?')) return
    const entries = s.entries.map((e) => ({ ...e, hasActed: false }))
    await saveInitiative({ ...s, entries, round: 1, currentIndex: 0 })
  }

  const initEnd = async () => {
    if (!confirm('Kampf-Initiative wirklich beenden?')) return
    await saveInitiative(null)
  }

  return {
    initiativeState,
    initEntryImageFailed,
    initActive,
    initEntries,
    initCurrentEntryId,
    currentTurnTokenId,
    myAwaitingChars,
    rollingCharId,
    rollInitiativeFor,
    saveInitiative,
    initStartFromTokens,
    initAddNpcs,
    initAddManual,
    initRemoveEntry,
    initRequestPlayerRolls,
    initFinishRequest,
    initAwaitingCount,
    initRequestDeadline,
    initRequestSecondsLeft,
    initCountdownLabel,
    initSetInitiative,
    initNextTurn,
    initPrevTurn,
    initSetRound,
    initResetRound,
    initEnd,
  }
}
