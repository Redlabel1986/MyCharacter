import { rgb } from 'pdf-lib'
import {
  HTBAH_TALENT_LABELS,
  HTBAH_TALENTS,
  htbahCalcSpentPoints,
  htbahInitiativeBonus,
  htbahInsightMax,
  htbahPoolTotal,
  htbahPointsRemaining,
  htbahSkillTotal,
  htbahStatus,
  htbahTalentValue,
  type HtbahCharacterData,
  type HtbahTalent,
} from '~~/shared/engines/htbah'
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  MARGIN,
  INK,
  INK_LIGHT,
  PARCHMENT_BORDER,
} from './theme'
import {
  addCalcField,
  addPage,
  addTextField,
  drawLabel,
  drawSection,
  drawStatBox,
  drawValue,
  finalizeCalcOrder,
  injectCalcHelpers,
  startPdf,
  type PdfContext,
} from './helpers'
import type { GameSystem } from '~~/shared/systems'

/** Slug fuer Feldnamen aus Skill-IDs (UUIDs gehen, aber kuerzer ist huebscher). */
const slug = (id: string) => id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'x'

const DEFAULT_NAME = 'Unbenannt'

export async function buildHtbahPdf(
  character: { name: string; system: GameSystem; data: HtbahCharacterData },
): Promise<Uint8Array> {
  const ctx = await startPdf(character.system)
  injectCalcHelpers(ctx)
  const data = character.data
  const charName = character.name || DEFAULT_NAME

  // Wir referenzieren Skills mehrfach — Mapping einmal aufbauen
  const skills = data.skills ?? []
  const advantages = data.advantages ?? []
  const disadvantages = data.disadvantages ?? []

  const skillFieldName = (sid: string) => `skill_${slug(sid)}_points`
  const skillModName = (sid: string) => `skill_${slug(sid)}_mod`
  const skillTotalName = (sid: string) => `skill_${slug(sid)}_total`
  const talentValueName = (t: HtbahTalent) => `talent_${t}_value`
  const insightMaxName = (t: HtbahTalent) => `talent_${t}_insight_max`
  const advCostName = (i: number) => `adv_${i}_cost`
  const disCostName = (i: number) => `dis_${i}_cost`

  // === SEITE 1: Identitaet, HP, Pool, Talente, Vor/Nachteile, Backstory ===
  const page1 = addPage(ctx)
  let y = PAGE_HEIGHT - MARGIN

  // Header — Name gross + System
  drawValue(ctx, page1, MARGIN, y - 22, 'How to be a Hero', {
    size: 9,
    color: INK_LIGHT,
  })
  addTextField(ctx, page1, 'name', MARGIN, y - 50, PAGE_WIDTH - 2 * MARGIN - 100, 26, charName, {
    size: 22,
  })
  // Status-Badge rechts
  drawLabel(ctx, page1, PAGE_WIDTH - MARGIN - 90, y - 22, 'STATUS')
  addCalcField(
    ctx,
    page1,
    'status',
    PAGE_WIDTH - MARGIN - 90,
    y - 50,
    90,
    20,
    statusLabel(htbahStatus(data.hp)),
    statusFormula(),
    { align: 'center', size: 11, bold: true },
  )
  y -= 70

  // Identitaet
  drawSection(ctx, page1, MARGIN, y, PAGE_WIDTH - 2 * MARGIN, 'Identitaet')
  y -= 26
  drawIdentityGrid(ctx, page1, y, data)
  y -= 110

  // HP / Pool — Zeile aus 3 Bloecken
  drawSection(ctx, page1, MARGIN, y, PAGE_WIDTH - 2 * MARGIN, 'Lebenspunkte & Pool')
  y -= 26
  drawHpPoolRow(ctx, page1, y, data, advantages, disadvantages, skills)
  y -= 92

  // Talente — Begabung / Geistesblitz / Initiative
  drawSection(ctx, page1, MARGIN, y, PAGE_WIDTH - 2 * MARGIN, 'Begabungen')
  y -= 26
  drawTalentsRow(ctx, page1, y, data, skills)
  y -= 76

  // Vor- und Nachteile (zwei Tabellen nebeneinander)
  drawSection(ctx, page1, MARGIN, y, PAGE_WIDTH - 2 * MARGIN, 'Vorteile & Nachteile')
  y -= 26
  drawPerksBlock(ctx, page1, y, advantages, disadvantages, advCostName, disCostName)
  y -= 130

  // Vorgeschichte
  drawSection(ctx, page1, MARGIN, y, PAGE_WIDTH - 2 * MARGIN, 'Vorgeschichte')
  y -= 26
  drawBackstoryBlock(ctx, page1, y, data)

  // === SEITE 2: Faehigkeiten + Inventar/Beute/Notizen ===
  const page2 = addPage(ctx)
  let y2 = PAGE_HEIGHT - MARGIN

  drawValue(ctx, page2, MARGIN, y2 - 18, charName, { size: 13, serif: true, bold: true })
  drawValue(ctx, page2, PAGE_WIDTH - MARGIN - 80, y2 - 18, 'Seite 2', {
    size: 9,
    color: INK_LIGHT,
  })
  y2 -= 36

  // Faehigkeiten — drei Spalten je Begabung
  drawSection(ctx, page2, MARGIN, y2, PAGE_WIDTH - 2 * MARGIN, 'Faehigkeiten')
  y2 -= 26
  drawSkillsBlock(
    ctx,
    page2,
    y2,
    skills,
    skillFieldName,
    skillModName,
    skillTotalName,
    talentValueName,
    data,
  )
  // Hoehe der Skills-Sektion variabel — schaetzen anhand Anzahl je Talent
  const maxRows = Math.max(
    ...HTBAH_TALENTS.map((t) => skills.filter((s) => s.talent === t).length),
  )
  y2 -= 36 + maxRows * 18 + 10

  // Inventar, Beute, Notizen
  if (y2 < 230) {
    // Wenn die Skills sehr lang sind, neue Seite
    const page3 = addPage(ctx)
    y2 = PAGE_HEIGHT - MARGIN - 18
    drawTextSection(ctx, page3, y2, 'Inventar', data.inventory ?? '', 'inventory')
    drawTextSection(ctx, page3, y2 - 130, 'Beute', data.beute ?? '', 'beute')
    drawTextSection(ctx, page3, y2 - 260, 'Notizen', data.notes ?? '', 'notes')
  } else {
    drawTextSection(ctx, page2, y2, 'Inventar', data.inventory ?? '', 'inventory')
    drawTextSection(ctx, page2, y2 - 100, 'Beute', data.beute ?? '', 'beute')
    drawTextSection(ctx, page2, y2 - 200, 'Notizen', data.notes ?? '', 'notes')
  }

  finalizeCalcOrder(ctx)
  return ctx.doc.save()

  // ============================================================
  // === Lokale Helpers — closure ueber ctx, page, names etc.  ===
  // ============================================================

  function statusFormula(): string {
    return `var hp = __num('hp_current'); event.value = hp <= 0 ? 'Tot' : (hp < 10 ? 'Bewusstlos' : 'Normal');`
  }

  function statusLabel(s: 'normal' | 'bewusstlos' | 'tot') {
    return s === 'tot' ? 'Tot' : s === 'bewusstlos' ? 'Bewusstlos' : 'Normal'
  }

  function drawIdentityGrid(
    c: PdfContext,
    page: Parameters<typeof addTextField>[1],
    yTop: number,
    d: HtbahCharacterData,
  ) {
    const colW = (PAGE_WIDTH - 2 * MARGIN - 30) / 3
    const rowH = 32
    const rows: Array<Array<{ key: keyof HtbahCharacterData['identity']; label: string }>> = [
      [
        { key: 'sex', label: 'Geschlecht' },
        { key: 'age', label: 'Alter' },
        { key: 'height', label: 'Statur' },
      ],
      [
        { key: 'occupation', label: 'Beruf' },
        { key: 'religion', label: 'Religion' },
        { key: 'maritalStatus', label: 'Familienstand' },
      ],
      [
        { key: 'appearance', label: 'Aussehen' },
        { key: 'voice', label: 'Stimme' },
        { key: 'clothing', label: 'Kleidung' },
      ],
    ]
    rows.forEach((row, ri) => {
      row.forEach((cell, ci) => {
        const x = MARGIN + ci * (colW + 15)
        const yRow = yTop - ri * rowH
        drawLabel(c, page, x + 4, yRow - 8, cell.label.toUpperCase())
        addTextField(
          c,
          page,
          `ident_${String(cell.key)}`,
          x,
          yRow - 26,
          colW,
          16,
          d.identity?.[cell.key] ?? '',
          { size: 10 },
        )
      })
    })
    // "Vorlieben" volle Breite unter dem Grid
    const xLikes = MARGIN
    const yLikes = yTop - 3 * rowH - 6
    drawLabel(c, page, xLikes + 4, yLikes, 'VORLIEBEN')
    addTextField(
      c,
      page,
      'ident_likes',
      xLikes,
      yLikes - 16,
      PAGE_WIDTH - 2 * MARGIN,
      16,
      d.identity?.likes ?? '',
      { size: 10 },
    )
  }

  function drawHpPoolRow(
    c: PdfContext,
    page: Parameters<typeof addTextField>[1],
    yTop: number,
    d: HtbahCharacterData,
    advs: typeof advantages,
    diss: typeof disadvantages,
    sks: typeof skills,
  ) {
    const blockW = (PAGE_WIDTH - 2 * MARGIN - 20) / 3
    // 1) HP
    let x = MARGIN
    drawStatBox(page, x, yTop - 70, blockW, 70)
    drawLabel(c, page, x + 8, yTop - 12, 'LEBENSPUNKTE')
    drawLabel(c, page, x + 12, yTop - 36, 'AKTUELL')
    addTextField(c, page, 'hp_current', x + 12, yTop - 56, 60, 18, String(d.hp?.current ?? 0), {
      size: 12,
      align: 'center',
      bold: true,
    })
    drawValue(ctx, page, x + 80, yTop - 50, '/', { size: 14, bold: true })
    drawLabel(c, page, x + 96, yTop - 36, 'MAX')
    addTextField(c, page, 'hp_max', x + 96, yTop - 56, 60, 18, String(d.hp?.max ?? 100), {
      size: 12,
      align: 'center',
    })

    // 2) Pool — Basis / Volk / Vorgeschichte / Effektiv (calc) / Verbraucht (calc) / Verbleibend (calc)
    x = MARGIN + blockW + 10
    drawStatBox(page, x, yTop - 70, blockW, 70)
    drawLabel(c, page, x + 8, yTop - 12, 'PUNKTE-POOL')
    // Linke Spalte: Eingaben
    addLabeledInput(c, page, x + 8, yTop - 30, 'BASIS', 'pool_total', String(d.pointsPool?.total ?? 400))
    addLabeledInput(c, page, x + 8, yTop - 52, 'VOLK', 'pool_race', String(d.pointsPool?.racePoints ?? 0))
    // Rechte Spalte: berechnet
    const xR = x + blockW / 2 + 4
    addLabeledCalc(
      c,
      page,
      xR,
      yTop - 30,
      'EFFEKTIV',
      'pool_effective',
      String(htbahPoolTotal(d)),
      poolEffectiveFormula(advs, diss),
    )
    addLabeledCalc(
      c,
      page,
      xR,
      yTop - 52,
      'VERBLEIBEND',
      'pool_remaining',
      String(htbahPointsRemaining(d)),
      `event.value = __num('pool_effective') - __num('pool_spent');`,
    )

    // 3) Berechnet: Verbraucht + Initiative + Vorgeschichte-Punkte
    x = MARGIN + 2 * (blockW + 10)
    drawStatBox(page, x, yTop - 70, blockW, 70)
    drawLabel(c, page, x + 8, yTop - 12, 'WEITERE')
    addLabeledCalc(
      c,
      page,
      x + 8,
      yTop - 30,
      'VERBRAUCHT',
      'pool_spent',
      String(htbahCalcSpentPoints(d)),
      `event.value = __sum([${sks.map((s) => `'${skillFieldName(s.id)}'`).join(',')}]);`,
    )
    addLabeledInput(
      c,
      page,
      x + 8,
      yTop - 52,
      'VORGESCH. PUNKTE',
      'pool_backstory',
      String(d.backstory?.points ?? 0),
    )
    addLabeledCalc(
      c,
      page,
      x + blockW / 2 + 4,
      yTop - 30,
      'INITIATIVE',
      'initiative_bonus',
      String(htbahInitiativeBonus(d)),
      `event.value = __num('${talentValueName('handeln')}');`,
    )
  }

  function poolEffectiveFormula(advs: typeof advantages, diss: typeof disadvantages): string {
    const advList = advs.map((_, i) => `'${advCostName(i)}'`).join(',')
    const disList = diss.map((_, i) => `'${disCostName(i)}'`).join(',')
    return `event.value = __num('pool_total') + __num('pool_race') + __sum([${disList}]) - __sum([${advList}]) + __num('pool_backstory');`
  }

  function addLabeledInput(
    c: PdfContext,
    page: Parameters<typeof addTextField>[1],
    x: number,
    y: number,
    label: string,
    name: string,
    initial: string,
  ) {
    drawLabel(c, page, x, y, label)
    addTextField(c, page, name, x + 70, y - 9, 36, 14, initial, { align: 'right', size: 10 })
  }

  function addLabeledCalc(
    c: PdfContext,
    page: Parameters<typeof addTextField>[1],
    x: number,
    y: number,
    label: string,
    name: string,
    initial: string,
    formula: string,
  ) {
    drawLabel(c, page, x, y, label)
    addCalcField(c, page, name, x + 70, y - 9, 36, 14, initial, formula, {
      align: 'right',
      size: 10,
      bold: true,
    })
  }

  function drawTalentsRow(
    c: PdfContext,
    page: Parameters<typeof addTextField>[1],
    yTop: number,
    d: HtbahCharacterData,
    sks: typeof skills,
  ) {
    const blockW = (PAGE_WIDTH - 2 * MARGIN - 20) / 3
    HTBAH_TALENTS.forEach((t, i) => {
      const x = MARGIN + i * (blockW + 10)
      drawStatBox(page, x, yTop - 56, blockW, 56)
      drawValue(c, page, x + 8, yTop - 14, HTBAH_TALENT_LABELS[t].toUpperCase(), {
        size: 9,
        bold: true,
        color: INK_LIGHT,
      })
      // Begabungswert (calc)
      const skillPointFields = sks
        .filter((s) => s.talent === t)
        .map((s) => `'${skillFieldName(s.id)}'`)
        .join(',')
      drawLabel(c, page, x + 8, yTop - 32, 'BEGABUNG')
      addCalcField(
        c,
        page,
        talentValueName(t),
        x + 70,
        yTop - 41,
        38,
        14,
        String(htbahTalentValue(d, t)),
        `event.value = __round(__sum([${skillPointFields}]) / 10);`,
        { align: 'right', size: 10, bold: true },
      )
      // Insight max (calc) und current (input)
      drawLabel(c, page, x + 8, yTop - 50, 'GEISTESBLITZ')
      addCalcField(
        c,
        page,
        insightMaxName(t),
        x + 70,
        yTop - 50 - 9,
        18,
        14,
        String(htbahInsightMax(d, t)),
        `event.value = __round(__num('${talentValueName(t)}') / 10);`,
        { align: 'right', size: 10, bold: true },
      )
      drawValue(c, page, x + 91, yTop - 53, '/', { size: 9 })
      addTextField(
        c,
        page,
        `talent_${t}_insight_current`,
        x + 96,
        yTop - 50 - 9,
        18,
        14,
        String(d.talents?.[t]?.insightCurrent ?? 0),
        { align: 'right', size: 10 },
      )
    })
  }

  function drawPerksBlock(
    c: PdfContext,
    page: Parameters<typeof addTextField>[1],
    yTop: number,
    advs: typeof advantages,
    diss: typeof disadvantages,
    advCostNm: typeof advCostName,
    disCostNm: typeof disCostName,
  ) {
    const blockW = (PAGE_WIDTH - 2 * MARGIN - 15) / 2
    drawPerksTable(c, page, MARGIN, yTop, blockW, 'Vorteile (kosten)', advs, 'adv', advCostNm)
    drawPerksTable(c, page, MARGIN + blockW + 15, yTop, blockW, 'Nachteile (geben)', diss, 'dis', disCostNm)
  }

  function drawPerksTable(
    c: PdfContext,
    page: Parameters<typeof addTextField>[1],
    x: number,
    yTop: number,
    width: number,
    title: string,
    items: typeof advantages,
    keyPrefix: 'adv' | 'dis',
    costName: (i: number) => string,
  ) {
    drawValue(c, page, x, yTop, title, { size: 9, bold: true, color: INK_LIGHT })
    const rowH = 16
    const rows = Math.max(items.length, 5)
    for (let i = 0; i < rows; i++) {
      const y = yTop - 14 - i * rowH
      const item = items[i]
      // Name
      addTextField(
        c,
        page,
        `${keyPrefix}_${i}_name`,
        x,
        y - rowH + 2,
        width - 50,
        rowH - 4,
        item?.name ?? '',
        { size: 9 },
      )
      // Cost
      addTextField(
        c,
        page,
        costName(i),
        x + width - 46,
        y - rowH + 2,
        46,
        rowH - 4,
        item ? String(item.cost ?? 0) : '',
        { size: 9, align: 'right' },
      )
      // Trennlinie
      page.drawLine({
        start: { x, y: y - rowH + 1 },
        end: { x: x + width, y: y - rowH + 1 },
        thickness: 0.3,
        color: PARCHMENT_BORDER,
        opacity: 0.35,
      })
    }
  }

  function drawBackstoryBlock(
    c: PdfContext,
    page: Parameters<typeof addTextField>[1],
    yTop: number,
    d: HtbahCharacterData,
  ) {
    const w = PAGE_WIDTH - 2 * MARGIN
    addTextField(c, page, 'backstory_text', MARGIN, yTop - 80, w - 110, 78, d.backstory?.text ?? '', {
      multiline: true,
      size: 9,
    })
    drawLabel(c, page, MARGIN + w - 100, yTop - 12, 'PUNKTE')
    addTextField(
      c,
      page,
      'pool_backstory_display',
      MARGIN + w - 100,
      yTop - 32,
      90,
      18,
      String(d.backstory?.points ?? 0),
      { size: 10, align: 'right' },
    )
    drawValue(c, page, MARGIN + w - 100, yTop - 48, '(siehe Pool oben)', {
      size: 7,
      color: INK_LIGHT,
    })
  }

  function drawSkillsBlock(
    c: PdfContext,
    page: Parameters<typeof addTextField>[1],
    yTop: number,
    sks: typeof skills,
    pointsName: (id: string) => string,
    modName: (id: string) => string,
    totalName: (id: string) => string,
    talentValName: (t: HtbahTalent) => string,
    d: HtbahCharacterData,
  ) {
    const colW = (PAGE_WIDTH - 2 * MARGIN - 20) / 3
    HTBAH_TALENTS.forEach((t, i) => {
      const x = MARGIN + i * (colW + 10)
      drawValue(c, page, x, yTop, HTBAH_TALENT_LABELS[t].toUpperCase(), {
        size: 9,
        bold: true,
        color: INK_LIGHT,
      })
      // Spalten-Header
      drawLabel(c, page, x + 4, yTop - 14, 'NAME')
      drawLabel(c, page, x + colW - 102, yTop - 14, 'P')
      drawLabel(c, page, x + colW - 70, yTop - 14, 'M')
      drawLabel(c, page, x + colW - 28, yTop - 14, 'TOTAL')

      const rowH = 18
      const items = sks.filter((s) => s.talent === t)
      const rows = Math.max(items.length, 8)
      for (let r = 0; r < rows; r++) {
        const ySkill = yTop - 22 - r * rowH
        const skill = items[r]
        // Name
        addTextField(
          c,
          page,
          skill ? `skill_${slug(skill.id)}_name` : `skill_${t}_blank_${r}_name`,
          x,
          ySkill - rowH + 4,
          colW - 110,
          rowH - 6,
          skill?.name ?? '',
          { size: 9 },
        )
        // Punkte (input)
        addTextField(
          c,
          page,
          skill ? pointsName(skill.id) : `skill_${t}_blank_${r}_points`,
          x + colW - 108,
          ySkill - rowH + 4,
          28,
          rowH - 6,
          skill ? String(skill.spentPoints ?? 0) : '',
          { size: 9, align: 'right' },
        )
        // Modifier (input)
        addTextField(
          c,
          page,
          skill ? modName(skill.id) : `skill_${t}_blank_${r}_mod`,
          x + colW - 76,
          ySkill - rowH + 4,
          28,
          rowH - 6,
          skill ? String(skill.modifier ?? 0) : '',
          { size: 9, align: 'right' },
        )
        // Total (calc)
        if (skill) {
          addCalcField(
            c,
            page,
            totalName(skill.id),
            x + colW - 36,
            ySkill - rowH + 4,
            36,
            rowH - 6,
            String(htbahSkillTotal(d, skill)),
            `event.value = __num('${pointsName(skill.id)}') + __num('${talentValName(skill.talent)}') + __num('${modName(skill.id)}');`,
            { size: 9, align: 'right', bold: true },
          )
        } else {
          addTextField(
            c,
            page,
            `skill_${t}_blank_${r}_total`,
            x + colW - 36,
            ySkill - rowH + 4,
            36,
            rowH - 6,
            '',
            { size: 9, align: 'right' },
          )
        }
      }
    })
  }

  function drawTextSection(
    c: PdfContext,
    page: Parameters<typeof addTextField>[1],
    yTop: number,
    title: string,
    initial: string,
    name: string,
  ) {
    drawSection(c, page, MARGIN, yTop, PAGE_WIDTH - 2 * MARGIN, title)
    addTextField(
      c,
      page,
      name,
      MARGIN,
      yTop - 26 - 70,
      PAGE_WIDTH - 2 * MARGIN,
      70,
      initial,
      { multiline: true, size: 9 },
    )
  }
}
