/**
 * Karten-Objekte (Props/Szenerie) der Battle-Map: Template-Katalog (Built-ins +
 * Admin-Globals + Custom), Picker, Platzieren, Bearbeiten (Drehen/Umbenennen/
 * Verstecken/Loeschen) und Custom-Template-Upload.
 *
 * Aus [mapId].vue herausgeloest. Verhalten unveraendert. Die LIVE-Drag-Handler
 * (Objekt auf der Stage ziehen) bleiben bewusst in der SFC, da sie eng mit der
 * Stage-Pointer-Maschinerie (stageEl/zoom/toolMode) verzahnt sind; `displayW/H`
 * bleiben ebenfalls dort (auch von useBattleFog genutzt). `editingObjectId` wird
 * als Ref hereingereicht (die SFC/fetchMap teilen es mit den Drag-Handlern).
 */
import type { Ref } from 'vue'
import {
  BUILT_IN_MAP_OBJECTS,
  CATEGORY_LABELS,
  type MapObjectCategory,
  type MapObjectTemplateBuiltin,
} from '~~/shared/map-objects'
import type { BattleMap, MapObject, CustomObjectTemplate } from '~~/shared/battle-types'

// Templates aus Built-ins + Custom kombiniert.
interface PickerTemplate {
  source: 'builtin' | 'custom' | 'global'
  key?: string
  id?: number
  name: string
  category: MapObjectCategory | string
  imageUrl: string
  width: number
  height: number
  rotatable: boolean
  lightRadius: number
}

export function useMapObjects(opts: {
  map: Ref<BattleMap | null>
  objects: Ref<MapObject[]>
  isDm: Ref<boolean>
  user: Ref<{ id: number } | null | undefined>
  imgW: Ref<number>
  imgH: Ref<number>
  groupId: number
  mapId: number
  fetchMap: () => Promise<void>
  editingObjectId: Ref<number | null>
}) {
  const { map, objects, isDm, user, imgW, imgH, groupId, mapId, fetchMap, editingObjectId } = opts

  const showObjectPicker = ref(false)
  const showObjectUpload = ref(false)
  const objectCategoryFilter = ref<MapObjectCategory | 'all'>('all')

  const customObjectTemplates = ref<CustomObjectTemplate[]>([])
  const globalObjectTemplates = ref<CustomObjectTemplate[]>([])

  const fetchObjectTemplates = async () => {
    try {
      const res = await $fetch<{
        templates: CustomObjectTemplate[]
        globals?: CustomObjectTemplate[]
      }>(`/api/groups/${groupId}/object-templates`)
      customObjectTemplates.value = res.templates ?? []
      globalObjectTemplates.value = res.globals ?? []
    } catch {
      customObjectTemplates.value = []
      globalObjectTemplates.value = []
    }
  }

  // Built-in-Overrides: built_in_key -> globales Template, das das Standard-SVG
  // ersetzt. Wird im Picker und beim Render der Karte angewendet.
  const builtInOverrideByKey = computed<Record<string, CustomObjectTemplate>>(() => {
    const m: Record<string, CustomObjectTemplate> = {}
    for (const g of globalObjectTemplates.value) {
      if (g.builtInKey) m[g.builtInKey] = g
    }
    return m
  })

  // Bild-URL fuer ein platziertes Objekt — beruecksichtigt aktuelle Admin-
  // Overrides fuer Built-ins, damit ein neu hochgeladenes Bild sofort fuer
  // bereits platzierte Built-in-Instanzen erscheint.
  const objectDisplayImage = (o: MapObject): string | null => {
    if (o.templateKey) {
      const ov = builtInOverrideByKey.value[o.templateKey]
      if (ov && ov.imageUrl) return `/api/admin/object-templates/${ov.id}/image`
    }
    return o.imageUrl
  }

  const allObjectTemplates = computed<PickerTemplate[]>(() => {
    const overrides = builtInOverrideByKey.value
    const built: PickerTemplate[] = BUILT_IN_MAP_OBJECTS.map((b: MapObjectTemplateBuiltin) => {
      const ov = overrides[b.key]
      return {
        source: 'builtin' as const,
        key: b.key,
        name: ov?.name ?? b.name,
        category: b.category,
        imageUrl: ov?.imageUrl ? `/api/admin/object-templates/${ov.id}/image` : b.imageUrl,
        width: ov?.width ?? b.width,
        height: ov?.height ?? b.height,
        rotatable: ov?.rotatable ?? b.rotatable,
        lightRadius: ov?.lightRadius ?? b.lightRadius,
      }
    })
    // Neue Admin-Globals (ohne builtInKey) erscheinen unterhalb der Built-ins.
    const globals: PickerTemplate[] = globalObjectTemplates.value
      .filter((g: CustomObjectTemplate) => !g.builtInKey)
      .map((g: CustomObjectTemplate) => ({
        source: 'global' as const,
        id: g.id,
        name: g.name,
        category: g.category,
        imageUrl: g.imageUrl ? `/api/admin/object-templates/${g.id}/image` : '',
        width: g.width,
        height: g.height,
        rotatable: g.rotatable,
        lightRadius: g.lightRadius,
      }))
    const custom: PickerTemplate[] = customObjectTemplates.value.map((c) => ({
      source: 'custom',
      id: c.id,
      name: c.name,
      category: c.category,
      imageUrl: c.imageUrl
        ? `/api/groups/${groupId}/object-templates/${c.id}/image`
        : '',
      width: c.width,
      height: c.height,
      rotatable: c.rotatable,
      lightRadius: c.lightRadius,
    }))
    return [...built, ...globals, ...custom]
  })

  const objectCategories = computed<Array<MapObjectCategory | 'all' | string>>(() => {
    const set = new Set<string>()
    for (const t of allObjectTemplates.value) set.add(String(t.category))
    return ['all', ...Array.from(set)]
  })

  const categoryLabel = (cat: string): string => {
    if (cat === 'all') return 'Alle'
    return (CATEGORY_LABELS as Record<string, string>)[cat] ?? cat
  }
  const setObjectCategoryFilter = (cat: string) => {
    objectCategoryFilter.value = cat as MapObjectCategory | 'all'
  }

  const filteredObjectTemplates = computed<PickerTemplate[]>(() => {
    if (objectCategoryFilter.value === 'all') return allObjectTemplates.value
    return allObjectTemplates.value.filter((t) => t.category === objectCategoryFilter.value)
  })

  const openObjectPicker = async () => {
    showObjectPicker.value = true
    await fetchObjectTemplates()
  }

  const placingObject = ref(false)
  const placeObjectFromTemplate = async (tpl: PickerTemplate) => {
    if (!map.value || placingObject.value) return
    placingObject.value = true
    try {
      // Platzieren so, dass die linke obere Ecke der Bounding-Box in der Mitte
      // des Bildbereichs landet (Objekte sind top-left positioniert).
      const cx = Math.round(imgW.value / 2 - (tpl.width * map.value.gridSize) / 2)
      const cy = Math.round(imgH.value / 2 - (tpl.height * map.value.gridSize) / 2)
      const body: Record<string, unknown> = { x: cx, y: cy }
      if (tpl.source === 'builtin') body.templateKey = tpl.key
      else body.templateId = tpl.id
      await $fetch(`/api/groups/${groupId}/maps/${mapId}/objects`, {
        method: 'POST',
        body,
      })
      showObjectPicker.value = false
      await fetchMap()
    } finally {
      placingObject.value = false
    }
  }

  // Wer darf ein Objekt bewegen/loeschen? Der DM darf alles; ein Spieler darf
  // nur Objekte aendern, die er selbst platziert hat.
  const canMoveObject = (o: MapObject) =>
    isDm.value || (user.value != null && o.ownerUserId === user.value.id)

  const editingObject = computed<MapObject | null>(
    () => objects.value.find((o: MapObject) => o.id === editingObjectId.value) ?? null,
  )

  // Pruefe, ob das aktuell editierte Objekt drehbar ist — sowohl built-in als
  // auch custom Templates haben das Flag, Snapshot speichert es nicht. Wir lesen
  // es zur Render-Zeit aus den Templates.
  const isObjectRotatable = (o: MapObject) => {
    if (o.templateKey) {
      return BUILT_IN_MAP_OBJECTS.find((b) => b.key === o.templateKey)?.rotatable ?? false
    }
    if (o.templateId) {
      return customObjectTemplates.value.find((c) => c.id === o.templateId)?.rotatable ?? false
    }
    return false
  }

  const rotateObject = async (delta: 90 | -90) => {
    const o = editingObject.value
    if (!o) return
    o.rotation = (((o.rotation + delta) % 360) + 360) % 360
    try {
      await $fetch(`/api/groups/${groupId}/maps/${mapId}/objects/${o.id}`, {
        method: 'PUT',
        body: { rotation: o.rotation },
      })
    } catch {
      await fetchMap()
    }
  }

  const saveObjectEdit = async () => {
    const o = editingObject.value
    if (!o) return
    const body: Record<string, unknown> = { name: o.name }
    if (isDm.value) body.hidden = o.hidden
    try {
      await $fetch(`/api/groups/${groupId}/maps/${mapId}/objects/${o.id}`, {
        method: 'PUT',
        body,
      })
    } catch {
      await fetchMap()
    }
    editingObjectId.value = null
    await fetchMap()
  }

  const removeObject = async () => {
    const o = editingObject.value
    if (!o) return
    if (!confirm(`Objekt „${o.name}" entfernen?`)) return
    await $fetch(`/api/groups/${groupId}/maps/${mapId}/objects/${o.id}`, {
      method: 'DELETE',
    })
    editingObjectId.value = null
    await fetchMap()
  }

  // Custom-Template-Upload (DM).
  const customTplDraft = ref({
    name: '',
    category: 'misc',
    width: 1,
    height: 1,
    lightRadius: 0,
    rotatable: false,
    file: null as File | null,
  })
  const customTplUploading = ref(false)
  const customTplError = ref<string | null>(null)
  const onCustomTplFile = (e: Event) => {
    const t = e.target as HTMLInputElement
    customTplDraft.value.file = t.files?.[0] ?? null
  }
  const uploadCustomTemplate = async () => {
    const d = customTplDraft.value
    if (!d.file || !d.name.trim()) {
      customTplError.value = 'Name und Bild benötigt.'
      return
    }
    customTplUploading.value = true
    customTplError.value = null
    try {
      const fd = new FormData()
      fd.append('file', d.file)
      fd.append('name', d.name.trim())
      fd.append('category', d.category)
      fd.append('width', String(d.width))
      fd.append('height', String(d.height))
      fd.append('lightRadius', String(d.lightRadius))
      fd.append('rotatable', d.rotatable ? 'true' : 'false')
      await $fetch(`/api/groups/${groupId}/object-templates`, {
        method: 'POST',
        body: fd,
      })
      customTplDraft.value = {
        name: '',
        category: 'misc',
        width: 1,
        height: 1,
        lightRadius: 0,
        rotatable: false,
        file: null,
      }
      showObjectUpload.value = false
      await fetchObjectTemplates()
    } catch (err: unknown) {
      customTplError.value =
        (err as { statusMessage?: string }).statusMessage ?? 'Upload fehlgeschlagen.'
    } finally {
      customTplUploading.value = false
    }
  }
  const deleteCustomTemplate = async (id: number | undefined) => {
    if (id === undefined) return
    if (!confirm('Custom-Objekt aus der Bibliothek entfernen?')) return
    try {
      await $fetch(`/api/groups/${groupId}/object-templates/${id}`, { method: 'DELETE' })
      await fetchObjectTemplates()
    } catch {
      /* ignore */
    }
  }

  return {
    showObjectPicker,
    showObjectUpload,
    objectCategoryFilter,
    customObjectTemplates,
    globalObjectTemplates,
    fetchObjectTemplates,
    builtInOverrideByKey,
    objectDisplayImage,
    allObjectTemplates,
    objectCategories,
    categoryLabel,
    setObjectCategoryFilter,
    filteredObjectTemplates,
    openObjectPicker,
    placingObject,
    placeObjectFromTemplate,
    canMoveObject,
    editingObject,
    isObjectRotatable,
    rotateObject,
    saveObjectEdit,
    removeObject,
    customTplDraft,
    customTplUploading,
    customTplError,
    onCustomTplFile,
    uploadCustomTemplate,
    deleteCustomTemplate,
  }
}
