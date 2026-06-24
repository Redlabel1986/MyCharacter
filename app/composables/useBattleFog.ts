/**
 * Fog of War, Sichtblocker-Mauern, Blackout- und Startbereich-Pinsel der
 * Battle-Map.
 *
 * Aus [mapId].vue herausgeloest. Verhalten unveraendert. Karte/Token/Objekte
 * sowie Bildmasse kommen als Refs herein; `snap`, `displayW/H` und die
 * Tageszeit-Sichtmaske als Callbacks (sie sind in der SFC definiert bzw. weiter
 * unten). Lokale Pinsel-Buffer werden waehrend des Zeichnens nur lokal gefuehrt
 * und bei pointerup ueber die flush-Funktionen an den Server gepusht.
 */
import type { Ref } from 'vue'
import {
  cellsInTokenVision as computeCellsInVision,
  computeVisibilityPolygon,
} from '~~/shared/fog'
import { distancePointToSegment } from '~~/shared/battle-geometry'
import type { BattleMap, Token, MapObject, Wall } from '~~/shared/battle-types'

interface VisionSource {
  id: string
  cx: number
  cy: number
  /** Radius in Pixeln (visionRadius * gridSize + halfCell, wie Zell-Sicht). */
  radiusPx: number
  /** Radius in Zellen (fuer Memory-Cells). */
  radiusCells: number
}

interface VisionPolygon {
  src: VisionSource
  points: Array<{ x: number; y: number }>
}

export function useBattleFog(opts: {
  map: Ref<BattleMap | null>
  tokens: Ref<Token[]>
  objects: Ref<MapObject[]>
  isDm: Ref<boolean>
  user: Ref<{ id: number } | null | undefined>
  imgW: Ref<number>
  imgH: Ref<number>
  groupId: number
  mapId: number
  fetchMap: () => Promise<void>
  snap: (x: number, y: number) => { x: number; y: number }
  displayW: (o: MapObject) => number
  displayH: (o: MapObject) => number
  /** Braucht die aktuelle Tageszeit eine Sicht-Maske (Nacht)? */
  requiresVisionMask: () => boolean
}) {
  const {
    map, tokens, objects, isDm, user, imgW, imgH,
    groupId, mapId, fetchMap, snap, displayW, displayH, requiresVisionMask,
  } = opts

  // --- Sichtblocker-Mauern (DM zeichnet, blocken die dynamische Beleuchtung) ---
  const walls = computed<Wall[]>(() => map.value?.walls ?? [])
  // In-progress wall while dragging.
  const wallDraft = ref<Wall | null>(null)
  const wallDrawing = ref(false)
  const wallSaving = ref(false)

  const persistWalls = async (next: Wall[]) => {
    if (!map.value) return
    // Optimistisch — UI sofort aktualisieren, Server folgt nach.
    map.value = { ...map.value, walls: next }
    wallSaving.value = true
    try {
      await $fetch(`/api/groups/${groupId}/maps/${mapId}`, {
        method: 'PUT',
        body: { walls: next },
      })
      await fetchMap()
    } catch (e) {
      console.error('Mauern speichern fehlgeschlagen', e)
    } finally {
      wallSaving.value = false
    }
  }

  const addWall = (w: Wall) => {
    // Mini-Mauern (kuerzer als 5px) verwerfen — vermutlich Fehlklicks.
    if (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < 5) return
    const next = [...walls.value, w]
    persistWalls(next)
  }

  const eraseWallAt = (px: number, py: number) => {
    if (!walls.value.length) return
    const HIT_PX = 8 // Pixel-Toleranz fuer Klick auf Mauer.
    let bestIdx = -1
    let bestDist = HIT_PX
    for (let i = 0; i < walls.value.length; i++) {
      const w = walls.value[i]!
      const d = distancePointToSegment(px, py, w.x1, w.y1, w.x2, w.y2)
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    if (bestIdx >= 0) {
      const next = walls.value.slice()
      next.splice(bestIdx, 1)
      persistWalls(next)
    }
  }

  const clearAllWalls = async () => {
    if (!map.value || !isDm.value) return
    if (!confirm('Alle Sichtblocker-Mauern auf dieser Karte loeschen?')) return
    await persistWalls([])
  }

  // --- Fog of War ---
  const fogCellSize = computed(() => map.value?.gridSize ?? 50)
  const fogOverlayId = computed(() => `fog-mask-${mapId}`)
  const fogGridCols = computed(() =>
    imgW.value && fogCellSize.value ? Math.ceil(imgW.value / fogCellSize.value) : 0,
  )
  const fogGridRows = computed(() =>
    imgH.value && fogCellSize.value ? Math.ceil(imgH.value / fogCellSize.value) : 0,
  )

  // Aktuelle Sichtquellen (Token + Objekt-Lichter), die zum Spieler-Sichtfeld
  // beitragen. Wird sowohl fuer die Zell-basierte Memory-Logik als auch fuer
  // das weiche Radial-Gradient-Overlay verwendet.
  const visionSources = computed<VisionSource[]>(() => {
    if (!map.value || !fogCellSize.value) return []
    const g = fogCellSize.value
    const uid = user.value?.id
    const out: VisionSource[] = []
    for (const t of tokens.value) {
      if (t.visionRadius <= 0) continue
      if (!isDm.value && uid !== undefined && t.ownerUserId !== uid) continue
      out.push({
        id: `tok-${t.id}`,
        cx: t.x,
        cy: t.y,
        // +0.5 Zelle Radius, damit die Sicht symmetrisch um den Token-Mittelpunkt
        // liegt (passt zur Zell-Sicht-Schwelle r + 0.5 in fog.ts).
        radiusPx: (t.visionRadius + 0.5) * g,
        radiusCells: t.visionRadius,
      })
    }
    for (const o of objects.value) {
      if (o.lightRadius <= 0) continue
      out.push({
        id: `obj-${o.id}`,
        cx: o.x + (displayW(o) * g) / 2,
        cy: o.y + (displayH(o) * g) / 2,
        radiusPx: (o.lightRadius + 0.5) * g,
        radiusCells: o.lightRadius,
      })
    }
    return out
  })

  // Sicht-Polygone fuer das weiche Radial-Gradient-Overlay: pro Quelle ein
  // Polygon, das die Mauern (Wand-Schatten) beruecksichtigt.
  const visionPolygons = computed<VisionPolygon[]>(() => {
    // Polygone werden nicht nur fuer Fog-of-War gebraucht — die Nacht-Maske
    // schneidet damit ihre Sicht-„Loecher" aus dem dunklen Overlay. Ohne dieses
    // Computed waeren die Spieler nachts in pitch black, sobald Fog deaktiviert
    // ist. Daher: rechnen, wenn Fog AN ist oder wenn die aktuelle Tageszeit
    // ein Sicht-Mask braucht (Nacht).
    const needForFog = map.value?.fogEnabled === true
    const needForTime = requiresVisionMask()
    if (!needForFog && !needForTime) return []
    const ws = walls.value
    return visionSources.value.map((src: VisionSource) => ({
      src,
      points: computeVisibilityPolygon({ x: src.cx, y: src.cy }, src.radiusPx, ws),
    }))
  })

  // Zellen, die durch aktuelle Token-Sicht + Objekt-Lichtquellen live
  // aufgedeckt sind (mit Mauern als Sichtblocker).
  const fogCurrentVisionSet = computed(() => {
    const set = new Set<string>()
    if (!map.value || !fogCellSize.value) return set
    const g = fogCellSize.value
    const ws = walls.value
    for (const src of visionSources.value) {
      const cells = computeCellsInVision(
        { centerX: src.cx, centerY: src.cy, visionRadius: src.radiusCells },
        g,
        ws,
      )
      for (const [c, r] of cells) set.add(`${c}|${r}`)
    }
    return set
  })

  // Vereinigte sichtbare Zellen: DM-manuelle Reveals + aktuelle Sicht +
  // (Memory-Zellen, falls aktiv).
  const fogVisibleSet = computed(() => {
    const set = new Set<string>(fogCurrentVisionSet.value)
    if (!map.value) return set
    for (const [c, r] of map.value.fogRevealed ?? []) set.add(`${c}|${r}`)
    if (map.value.fogMemory) {
      for (const [c, r] of map.value.fogExplored ?? []) set.add(`${c}|${r}`)
    }
    return set
  })

  // Lokaler Pinsel-Buffer: Aenderungen werden waehrend des Zeichnens nur lokal
  // gefuehrt und bei pointerup an den Server gepusht.
  const fogBrushDirty = ref(false)
  const fogLocalRevealed = ref<Array<[number, number]>>([])
  watch(
    () => map.value?.fogRevealed,
    (v) => {
      if (!fogBrushDirty.value) fogLocalRevealed.value = (v ?? []).map((p) => [...p] as [number, number])
    },
    { immediate: true },
  )
  const effectiveFogRevealed = computed<Array<[number, number]>>(() =>
    fogBrushDirty.value ? fogLocalRevealed.value : map.value?.fogRevealed ?? [],
  )
  // Visible-Set unter Beruecksichtigung des lokalen Pinsel-Buffers, damit der
  // DM die Pinsel-Effekte sofort sieht.
  const fogVisibleSetEffective = computed(() => {
    const set = new Set<string>(fogCurrentVisionSet.value)
    if (!map.value) return set
    for (const [c, r] of effectiveFogRevealed.value) set.add(`${c}|${r}`)
    if (map.value.fogMemory) {
      for (const [c, r] of map.value.fogExplored ?? []) set.add(`${c}|${r}`)
    }
    return set
  })

  // Token-Sichtbarkeit fuer den Viewer: Spieler sehen Tokens nur, wenn deren
  // visuelle Box mindestens eine aktuell beleuchtete / aufgedeckte / erinnerte
  // Zelle ueberlappt (oder es das eigene Token ist). DM sieht alles.
  const isTokenVisibleToViewer = (t: Token): boolean => {
    if (isDm.value) return true
    if (!map.value?.fogEnabled) return true
    if (user.value && t.ownerUserId === user.value.id) return true
    const g = map.value.gridSize || 0
    if (g === 0) return true
    // t.x/t.y = visueller Mittelpunkt. Bounding-Box = Token-Mittelpunkt +/- halfPx.
    const halfPx = (t.sizeMultiplier * g) / 2
    const minCol = Math.floor((t.x - halfPx) / g)
    const maxCol = Math.floor((t.x + halfPx - 0.001) / g)
    const minRow = Math.floor((t.y - halfPx) / g)
    const maxRow = Math.floor((t.y + halfPx - 0.001) / g)
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (fogVisibleSetEffective.value.has(`${col}|${row}`)) return true
      }
    }
    return false
  }

  // Fuer das Rendering: alle sichtbaren Zellen im Karten-Bereich als Tupel-Liste.
  const fogVisibleCellsList = computed<Array<[number, number]>>(() => {
    if (!map.value) return []
    const cols = fogGridCols.value
    const rows = fogGridRows.value
    const out: Array<[number, number]> = []
    for (const key of fogVisibleSetEffective.value) {
      const parts = key.split('|')
      const c = Number(parts[0])
      const r = Number(parts[1])
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue
      if (c < 0 || r < 0) continue
      if (c >= cols || r >= rows) continue
      out.push([c, r])
    }
    return out
  })

  // Memory-Zellen: DM-Pinsel + (optional) bereits gesehene Zellen. NICHT die
  // aktuelle dynamische Sicht — die malt das weiche Polygon. Memory wird als
  // gedimmtes Grau gerendert: der Spieler weiss "war hier mal sichtbar",
  // sieht aber kein lebendiges Detail mehr.
  const fogMemoryCellsList = computed<Array<[number, number]>>(() => {
    if (!map.value) return []
    const cols = fogGridCols.value
    const rows = fogGridRows.value
    const set = new Set<string>()
    for (const [c, r] of effectiveFogRevealed.value) set.add(`${c}|${r}`)
    if (map.value.fogMemory) {
      for (const [c, r] of map.value.fogExplored ?? []) set.add(`${c}|${r}`)
    }
    const out: Array<[number, number]> = []
    for (const key of set) {
      const parts = key.split('|')
      const c = Number(parts[0])
      const r = Number(parts[1])
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue
      out.push([c, r])
    }
    return out
  })

  // Pixelposition -> Zellindex
  const cellAtPixel = (px: number, py: number): [number, number] | null => {
    const g = fogCellSize.value
    if (!g || px < 0 || py < 0) return null
    return [Math.floor(px / g), Math.floor(py / g)]
  }

  const paintFogCell = (cell: [number, number], reveal: boolean) => {
    if (!map.value || !isDm.value) return
    const key = `${cell[0]}|${cell[1]}`
    const idx = fogLocalRevealed.value.findIndex(([c, r]) => `${c}|${r}` === key)
    if (reveal && idx === -1) {
      fogLocalRevealed.value = [...fogLocalRevealed.value, cell]
      fogBrushDirty.value = true
    } else if (!reveal && idx !== -1) {
      const next = fogLocalRevealed.value.slice()
      next.splice(idx, 1)
      fogLocalRevealed.value = next
      fogBrushDirty.value = true
    }
  }

  const fogBrushActive = ref(false)
  const fogPaintMode = ref<'reveal' | 'conceal'>('reveal')

  // --- Blackout-Pinsel (vom DM gemalte 100%-Pitch-Black-Zellen) ---
  const fogBlackoutDirty = ref(false)
  const fogLocalBlackout = ref<Array<[number, number]>>([])
  watch(
    () => map.value?.fogBlackout,
    (v: Array<[number, number]> | undefined) => {
      if (!fogBlackoutDirty.value) {
        fogLocalBlackout.value = (v ?? []).map((p: [number, number]) => [...p] as [number, number])
      }
    },
    { immediate: true },
  )
  const effectiveFogBlackout = computed<Array<[number, number]>>(() =>
    fogBlackoutDirty.value ? fogLocalBlackout.value : map.value?.fogBlackout ?? [],
  )
  const fogBlackoutSet = computed<Set<string>>(() => {
    const s = new Set<string>()
    for (const [c, r] of effectiveFogBlackout.value) s.add(`${c}|${r}`)
    return s
  })
  const paintBlackoutCell = (cell: [number, number], blackout: boolean) => {
    if (!map.value || !isDm.value) return
    const key = `${cell[0]}|${cell[1]}`
    const idx = fogLocalBlackout.value.findIndex(([c, r]) => `${c}|${r}` === key)
    if (blackout && idx === -1) {
      fogLocalBlackout.value = [...fogLocalBlackout.value, cell]
      fogBlackoutDirty.value = true
    } else if (!blackout && idx !== -1) {
      const next = fogLocalBlackout.value.slice()
      next.splice(idx, 1)
      fogLocalBlackout.value = next
      fogBlackoutDirty.value = true
    }
  }
  const blackoutBrushActive = ref(false)
  const blackoutPaintMode = ref<'blackout' | 'unblackout'>('blackout')
  const flushBlackoutBrush = async () => {
    if (!fogBlackoutDirty.value || !map.value) return
    const payload = fogLocalBlackout.value
    fogBlackoutDirty.value = false
    try {
      await $fetch(`/api/groups/${groupId}/maps/${mapId}`, {
        method: 'PUT',
        body: { fogBlackout: payload },
      })
      await fetchMap()
    } catch (e) {
      fogBlackoutDirty.value = true
      console.error('Blackout speichern fehlgeschlagen', e)
    }
  }
  const fogBlackoutCellsList = computed<Array<[number, number]>>(() => {
    if (!map.value) return []
    const cols = fogGridCols.value
    const rows = fogGridRows.value
    const out: Array<[number, number]> = []
    for (const [c, r] of effectiveFogBlackout.value) {
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue
      out.push([c, r])
    }
    return out
  })
  const clearAllBlackout = async () => {
    if (!map.value || !isDm.value) return
    if (!confirm('Alle pitch-black Bereiche entfernen?')) return
    fogLocalBlackout.value = []
    fogBlackoutDirty.value = true
    await flushBlackoutBrush()
  }

  // --- Startbereich (vom DM gemalte Spawn-Zellen) ---
  // Neue Tokens spawnen auf einer freien Zelle dieses Bereichs statt in der
  // Kartenmitte. Lokaler Pinsel-Buffer wie bei Fog/Blackout: waehrend des
  // Zeichnens nur lokal, bei pointerup an den Server gepusht.
  const startAreaDirty = ref(false)
  const startAreaLocal = ref<Array<[number, number]>>([])
  watch(
    () => map.value?.startCells,
    (v: Array<[number, number]> | undefined) => {
      if (!startAreaDirty.value) {
        startAreaLocal.value = (v ?? []).map((p: [number, number]) => [...p] as [number, number])
      }
    },
    { immediate: true },
  )
  const effectiveStartCells = computed<Array<[number, number]>>(() =>
    startAreaDirty.value ? startAreaLocal.value : map.value?.startCells ?? [],
  )
  const paintStartCell = (cell: [number, number], add: boolean) => {
    if (!map.value || !isDm.value) return
    const key = `${cell[0]}|${cell[1]}`
    const idx = startAreaLocal.value.findIndex(([c, r]) => `${c}|${r}` === key)
    if (add && idx === -1) {
      startAreaLocal.value = [...startAreaLocal.value, cell]
      startAreaDirty.value = true
    } else if (!add && idx !== -1) {
      const next = startAreaLocal.value.slice()
      next.splice(idx, 1)
      startAreaLocal.value = next
      startAreaDirty.value = true
    }
  }
  const startAreaBrushActive = ref(false)
  const startAreaPaintMode = ref<'add' | 'remove'>('add')
  const flushStartArea = async () => {
    if (!startAreaDirty.value || !map.value) return
    const payload = startAreaLocal.value
    startAreaDirty.value = false
    try {
      await $fetch(`/api/groups/${groupId}/maps/${mapId}`, {
        method: 'PUT',
        body: { startCells: payload },
      })
      await fetchMap()
    } catch (e) {
      startAreaDirty.value = true
      console.error('Startbereich speichern fehlgeschlagen', e)
    }
  }
  const startAreaCellsList = computed<Array<[number, number]>>(() => {
    if (!map.value) return []
    const cols = fogGridCols.value
    const rows = fogGridRows.value
    const out: Array<[number, number]> = []
    for (const [c, r] of effectiveStartCells.value) {
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue
      out.push([c, r])
    }
    return out
  })
  const clearStartArea = async () => {
    if (!map.value || !isDm.value) return
    if (!confirm('Startbereich entfernen? Tokens spawnen dann wieder in der Mitte.')) return
    startAreaLocal.value = []
    startAreaDirty.value = true
    await flushStartArea()
  }

  // Spawn-Position fuer einen neuen Token: bevorzugt eine freie (nicht von einem
  // Token belegte) Zelle des Startbereichs, sonst irgendeine Start-Zelle, sonst
  // die Kartenmitte. Ergebnis ist auf das Raster gesnappt.
  const pickSpawnPosition = (): { x: number; y: number } => {
    const g = map.value?.gridSize || 50
    const cells = map.value?.startCells ?? []
    if (cells.length) {
      const occupied = new Set<string>()
      for (const t of tokens.value) {
        occupied.add(`${Math.floor(t.x / g)}|${Math.floor(t.y / g)}`)
      }
      const free = cells.filter(([c, r]) => !occupied.has(`${c}|${r}`))
      const pool = free.length ? free : cells
      const [c, r] = pool[Math.floor(Math.random() * pool.length)]!
      return snap(c * g + g / 2, r * g + g / 2)
    }
    return snap(imgW.value / 2, imgH.value / 2)
  }

  const flushFogBrush = async () => {
    if (!fogBrushDirty.value || !map.value) return
    const payload = fogLocalRevealed.value
    fogBrushDirty.value = false
    try {
      await $fetch(`/api/groups/${groupId}/maps/${mapId}`, {
        method: 'PUT',
        body: { fogRevealed: payload },
      })
      await fetchMap()
    } catch (e) {
      // Bei Fehler den lokalen Buffer nicht resetten, damit kein Datenverlust.
      fogBrushDirty.value = true
      console.error('Fog speichern fehlgeschlagen', e)
    }
  }

  const fogRevealAll = async () => {
    if (!map.value) return
    if (!confirm('Komplette Karte fuer Spieler aufdecken?')) return
    const all: Array<[number, number]> = []
    for (let r = 0; r < fogGridRows.value; r++) {
      for (let c = 0; c < fogGridCols.value; c++) all.push([c, r])
    }
    fogLocalRevealed.value = all
    fogBrushDirty.value = true
    await flushFogBrush()
  }

  const fogClearAll = async () => {
    if (!map.value) return
    if (!confirm('Komplette Karte wieder zudecken (auch Memory loeschen)?')) return
    fogLocalRevealed.value = []
    fogBrushDirty.value = true
    await $fetch(`/api/groups/${groupId}/maps/${mapId}`, {
      method: 'PUT',
      body: { fogRevealed: [], fogExplored: [] },
    })
    fogBrushDirty.value = false
    await fetchMap()
  }

  return {
    walls,
    wallDraft,
    wallDrawing,
    wallSaving,
    persistWalls,
    addWall,
    eraseWallAt,
    clearAllWalls,
    fogCellSize,
    fogOverlayId,
    fogGridCols,
    fogGridRows,
    visionSources,
    visionPolygons,
    fogCurrentVisionSet,
    effectiveFogRevealed,
    fogVisibleSet,
    fogVisibleSetEffective,
    isTokenVisibleToViewer,
    fogVisibleCellsList,
    fogMemoryCellsList,
    cellAtPixel,
    paintFogCell,
    fogBrushActive,
    fogPaintMode,
    fogBlackoutSet,
    paintBlackoutCell,
    blackoutBrushActive,
    blackoutPaintMode,
    flushBlackoutBrush,
    fogBlackoutCellsList,
    clearAllBlackout,
    paintStartCell,
    startAreaBrushActive,
    startAreaPaintMode,
    flushStartArea,
    startAreaCellsList,
    clearStartArea,
    pickSpawnPosition,
    flushFogBrush,
    fogRevealAll,
    fogClearAll,
  }
}
