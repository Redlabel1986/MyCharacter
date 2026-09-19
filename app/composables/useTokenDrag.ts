/**
 * Zieh-Regeln fuer Tokens — gemeinsam fuer die 2D- und die 3D-Buehne.
 *
 * Aus [mapId].vue herausgeloest. Dort steckten zwei Dinge in denselben
 * Handlern: die Umrechnung Bildschirm -> Kartenpixel und die Spielregeln der
 * Bewegung. Nur das Erste unterscheidet sich zwischen den Buehnen — die 2D-
 * Buehne rechnet ueber rect + zoom, die 3D-Buehne ueber einen Raycast gegen
 * die Bodenebene. Alles danach ist identisch und liegt deshalb hier.
 *
 * Was bewusst NICHT hier liegt: die Entscheidung, was ein Zeiger-Ende ohne
 * Bewegung bedeutet. `end` meldet nur `moved`; ob daraufhin die Info-Karte
 * aufgeht, entscheidet die Seite. Das hat mit Bewegung nichts zu tun.
 */
import type { Ref } from 'vue'
import { clampToMoveRange, snapToGrid } from '~~/shared/battle-geometry'
import type { BattleMap, Token } from '~~/shared/battle-types'

export interface DragStart {
  x: number
  y: number
  moveRange: number
}

export function useTokenDrag(opts: {
  map: Ref<BattleMap | null>
  tokens: Ref<Token[]>
  isDm: Ref<boolean>
  /**
   * Wird von aussen hereingereicht, nicht hier angelegt: die Seite deklariert
   * ihn frueh, weil `fetchMap` ihn braucht, um ein gerade gezogenes Token vor
   * dem Ueberschreiben durch Server-Daten zu schuetzen.
   */
  draggingTokenId: Ref<number | null>
  groupId: number
  mapId: number
  /** Wird nach einem fehlgeschlagenen Speichern gerufen (Server-Stand holen). */
  onPersistFailed: () => void | Promise<void>
}) {
  const { map, tokens, isDm, draggingTokenId, groupId, mapId, onPersistFailed } = opts

  /** Start-Position des Tokens in Kartenpixeln, fuer die Reichweiten-Klemmung. */
  const dragStartTokenPos = ref<DragStart | null>(null)
  /** Abstand Greifpunkt -> Token-Mittelpunkt, damit die Figur nicht springt. */
  const dragOffset = ref({ x: 0, y: 0 })
  /** Wurde seit `begin` tatsaechlich bewegt? Trennt Zug von Klick. */
  const moved = ref(false)

  /**
   * Bewegungsfeld-Overlay: markiert waehrend des Ziehens die erreichbaren
   * Zellen. Auch der DM sieht es (er darf frei schieben, aber die
   * Visualisierung hilft am Tisch).
   */
  const moveRangeOverlay = computed<{ x: number; y: number; size: number } | null>(() => {
    const start = dragStartTokenPos.value
    if (!start || !map.value || start.moveRange <= 0) return null
    const g = map.value.gridSize
    if (g <= 0) return null
    const halfSize = start.moveRange * g + g / 2
    return { x: start.x - halfSize, y: start.y - halfSize, size: 2 * halfSize }
  })

  /**
   * Gesnapptes Ziel der laufenden Bewegung. Die 3D-Buehne zeichnet dort ihren
   * Ring; die 2D-Buehne braucht es nicht, weil das Token selbst schon dort
   * klebt.
   */
  const snapPreview = computed<{ x: number; y: number } | null>(() => {
    const id = draggingTokenId.value
    if (id === null || !map.value) return null
    const t = tokens.value.find((x) => x.id === id)
    if (!t) return null
    return snapToGrid(t.x, t.y, map.value.gridType, map.value.gridSize)
  })

  const currentToken = (): Token | null =>
    tokens.value.find((x) => x.id === draggingTokenId.value) ?? null

  /** Zug beginnen. `mapX/mapY` ist der Greifpunkt in Kartenpixeln. */
  const begin = (token: Token, mapX: number, mapY: number): void => {
    dragOffset.value = { x: mapX - token.x, y: mapY - token.y }
    dragStartTokenPos.value = {
      x: token.x,
      y: token.y,
      moveRange: token.moveRange ?? 8,
    }
    draggingTokenId.value = token.id
    moved.value = false
  }

  /** Zielpunkt in Kartenpixeln. Klemmt Spieler auf ihre Reichweite. */
  const moveTo = (mapX: number, mapY: number): void => {
    const t = currentToken()
    if (!t || !map.value) return
    let nextX = mapX - dragOffset.value.x
    let nextY = mapY - dragOffset.value.y
    // Der DM darf frei verschieben (Aufbau, Storytelling, Korrigieren), der
    // Spieler nur innerhalb seiner Bewegungsreichweite.
    if (!isDm.value && dragStartTokenPos.value) {
      const c = clampToMoveRange(nextX, nextY, dragStartTokenPos.value, map.value.gridSize)
      nextX = c.x
      nextY = c.y
    }
    t.x = Math.round(nextX)
    t.y = Math.round(nextY)
    moved.value = true
  }

  /**
   * Zug beenden: rasten, erneut klemmen, speichern.
   *
   * Das zweite Klemmen ist kein Versehen — ohne es koennte ein Spieler per
   * Shift-Zug am Rasterfang vorbei sein Reichweitenlimit ueberschreiten.
   */
  const end = async (o?: { shiftKey?: boolean }): Promise<{ moved: boolean; tokenId: number | null }> => {
    const id = draggingTokenId.value
    if (id === null) return { moved: false, tokenId: null }
    const t = currentToken()
    const wasMoved = moved.value
    const startPos = dragStartTokenPos.value

    draggingTokenId.value = null
    dragStartTokenPos.value = null
    moved.value = false

    if (!t) return { moved: false, tokenId: id }
    if (!wasMoved) return { moved: false, tokenId: id }

    if (!o?.shiftKey && map.value) {
      const s = snapToGrid(t.x, t.y, map.value.gridType, map.value.gridSize)
      t.x = s.x
      t.y = s.y
    }
    if (!isDm.value && startPos && map.value) {
      const c = clampToMoveRange(t.x, t.y, startPos, map.value.gridSize)
      t.x = Math.round(c.x)
      t.y = Math.round(c.y)
    }

    try {
      await $fetch(`/api/groups/${groupId}/maps/${mapId}/tokens/${id}`, {
        method: 'PUT',
        body: { x: t.x, y: t.y },
      })
    } catch {
      await onPersistFailed()
    }
    return { moved: true, tokenId: id }
  }

  /** Abbrechen ohne zu speichern — fuer `pointercancel`. */
  const cancel = (): void => {
    draggingTokenId.value = null
    dragStartTokenPos.value = null
    moved.value = false
  }

  return {
    draggingTokenId,
    dragStartTokenPos,
    moveRangeOverlay,
    snapPreview,
    begin,
    moveTo,
    end,
    cancel,
  }
}
