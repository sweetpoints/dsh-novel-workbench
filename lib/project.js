/**
 * Novel workbench project model.
 *
 * A project is a fixed directory tree of Markdown files (see LAYOUT). The
 * trackers are small pipe tables so both the author and the tools can read
 * them without a parser of their own. This module owns the layout, the
 * scaffolding, the tolerant table parsing, and the audits shared by the tools.
 *
 * @module @sweetpoints/dsh-novel-workbench/lib/project
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** Relative paths that make up a project. */
export const LAYOUT = Object.freeze({
  brief: '00-立项.md',
  world: '01-设定/世界.md',
  style: '01-设定/文风.md',
  glossary: '01-设定/术语表.md',
  timeline: '01-设定/时间线.md',
  characters: '01-设定/人物',
  structure: '02-结构/全书结构.md',
  volumes: '02-结构/卷纲.md',
  outline: '02-结构/章纲.md',
  changeLog: '02-结构/结构变更日志.md',
  chapters: '03-正文',
  ledger: '04-追踪/总表.md',
  foreshadow: '04-追踪/伏笔账本.md',
  review: '05-审校/审校清单.md',
  decisions: '06-工作台/决策记录.md',
  drafts: '06-工作台/草稿',
  material: '06-工作台/素材.md',
})

/** Files every scaffolded project gets; the chapter body directory starts empty. */
export const SCAFFOLD = Object.freeze([
  '00-立项.md',
  '01-设定/世界.md',
  '01-设定/文风.md',
  '01-设定/术语表.md',
  '01-设定/时间线.md',
  '01-设定/人物/主角.md',
  '01-设定/人物/对手.md',
  '02-结构/全书结构.md',
  '02-结构/卷纲.md',
  '02-结构/章纲.md',
  '02-结构/结构变更日志.md',
  '04-追踪/总表.md',
  '04-追踪/伏笔账本.md',
  '05-审校/审校清单.md',
  '06-工作台/决策记录.md',
  '06-工作台/素材.md',
  '06-工作台/草稿/说明.md',
  '06-工作台/审校报告/说明.md',
  '项目说明.md',
])

const CHAPTER_FILE = /^第(\d+)章.*\.md$/u

/* ------------------------------------------------------------------ numbers */

/** First integer inside a table cell; undefined when the cell holds none. */
export function toInteger(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  const match = String(value ?? '').match(/-?\d+/u)
  if (match === null) return undefined
  return Number.parseInt(match[0], 10)
}

/** Non-whitespace character count, the unit Chinese serialization uses. */
export function countChars(text) {
  return (text.match(/\S/gu) ?? []).length
}

/* ------------------------------------------------------------------- tables */

function splitRow(line) {
  const trimmed = line.trim()
  const body = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const inner = body.endsWith('|') ? body.slice(0, -1) : body
  return inner.split('|').map(cell => cell.trim())
}

function normalizeHeader(cell) {
  return cell.replace(/[*`]/gu, '').replace(/\s+/gu, '')
}

function isSeparator(cells) {
  return cells.length > 0 && cells.every(cell => cell === '' || /^:?-{2,}:?$/u.test(cell))
}

/**
 * Read the first pipe table whose header contains `anchor`.
 *
 * Tolerant by design: a renamed column or a stray blank row should degrade a
 * check to a warning, never throw. Returns an empty table when nothing matches.
 */
export function parseTable(text, anchor) {
  const lines = String(text ?? '').split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.includes('|')) continue
    const headerCells = splitRow(line).map(normalizeHeader)
    if (!headerCells.includes(anchor)) continue
    const rows = []
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = lines[cursor]
      if (!next.includes('|')) break
      const cells = splitRow(next)
      if (isSeparator(cells)) continue
      if (cells.every(cell => cell === '')) continue
      const row = {}
      headerCells.forEach((header, column) => {
        if (header !== '') row[header] = cells[column] ?? ''
      })
      rows.push(row)
    }
    return { headers: headerCells.filter(Boolean), rows }
  }
  return { headers: [], rows: [] }
}

/* --------------------------------------------------------------- characters */

const CHARACTER_FIELDS = Object.freeze({
  姓名: 'fullName',
  别名: 'aliases',
  动机: 'motivation',
  目标: 'goal',
  缺陷: 'flaw',
  秘密: 'secret',
  弧光: 'arc',
  口吻: 'voice',
  首次出场: 'firstSeen',
  最近出场: 'lastSeen',
})

function parseCharacter(name, text) {
  const card = { name, fullName: '', aliases: '', motivation: '', goal: '', flaw: '', secret: '', arc: '', voice: '', firstSeen: '', lastSeen: '' }
  for (const line of String(text ?? '').split(/\r?\n/u)) {
    const match = line.match(/^\s*[-*]\s*([^：:]{1,24})\s*[：:]\s*(.*)$/u)
    if (match === null) continue
    // Field labels may carry a parenthetical hint, as the templates do:
    // `- 动机（抽象地想要什么）：` reads as the `动机` field.
    const field = CHARACTER_FIELDS[match[1].replace(/[（(][^）)]*[）)]/gu, '').trim()]
    if (field === undefined) continue
    if (card[field] === '') card[field] = match[2].trim()
  }
  return card
}

function readCharacterCards(dir) {
  const folder = join(dir, LAYOUT.characters)
  if (!existsSync(folder)) return []
  const cards = []
  for (const entry of readdirSync(folder).sort()) {
    if (!entry.endsWith('.md')) continue
    const text = readFileSync(join(folder, entry), 'utf8')
    cards.push(parseCharacter(basename(entry, '.md'), text))
  }
  return cards
}

/* ------------------------------------------------------------------ chapter */

export function chapterFileName(number) {
  return `第${String(number).padStart(3, '0')}章.md`
}

function listChapters(dir) {
  const folder = join(dir, LAYOUT.chapters)
  if (!existsSync(folder)) return []
  const chapters = []
  for (const entry of readdirSync(folder).sort()) {
    const match = entry.match(CHAPTER_FILE)
    if (match === null) continue
    const text = readFileSync(join(folder, entry), 'utf8')
    chapters.push({ n: Number.parseInt(match[1], 10), file: join(folder, entry), chars: countChars(text) })
  }
  return chapters.sort((a, b) => a.n - b.n)
}

/* ------------------------------------------------------------------- project */

function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function projectTitle(briefText) {
  const match = String(briefText ?? '').match(/^\s*[-*]\s*书名\s*[：:]\s*(.+)$/mu)
  return match === null ? '' : match[1].trim()
}

function projectGenre(briefText) {
  const match = String(briefText ?? '').match(/^\s*[-*]\s*(?:类型|类型\/题材)\s*[：:]\s*(.+)$/mu)
  return match === null ? '' : match[1].trim()
}

export function isNovelProject(dir) {
  return existsSync(join(dir, LAYOUT.brief))
}

/**
 * Load a project into plain data. Missing trackers read as empty; a missing
 * `00-立项.md` means the directory is not a project and throws.
 */
export async function loadProject(dir) {
  if (!existsSync(dir)) throw new Error(`project directory not found: ${dir}`)
  const brief = readText(join(dir, LAYOUT.brief))
  if (brief === undefined) {
    throw new Error(`not a novel workbench project (missing ${LAYOUT.brief}): ${dir}. Run novel_init first, or point dir at the project root.`)
  }
  const missing = []
  const optional = { ...LAYOUT }
  for (const [key, relative] of Object.entries(LAYOUT)) {
    if (key === 'brief' || key === 'chapters' || key === 'characters') continue
    if (!existsSync(join(dir, relative))) missing.push(relative)
  }

  const outlineText = readText(join(dir, LAYOUT.outline)) ?? ''
  const ledgerText = readText(join(dir, LAYOUT.ledger)) ?? ''
  const foreshadowText = readText(join(dir, LAYOUT.foreshadow)) ?? ''

  const outlineTable = parseTable(outlineText, '章')
  const outline = []
  for (const row of outlineTable.rows) {
    const n = toInteger(row['章'])
    if (n === undefined || n <= 0) continue
    outline.push({
      n,
      pov: row['POV'] ?? '',
      goal: row['目标'] ?? '',
      turn: row['转折'] ?? '',
      hook: row['钩子'] ?? '',
      answer: row['回应对接'] ?? '',
      foreshadow: row['伏笔'] ?? '',
      target: toInteger(row['目标字数']),
    })
  }
  outline.sort((a, b) => a.n - b.n)

  const ledgerTable = parseTable(ledgerText, '章')
  const ledger = []
  for (const row of ledgerTable.rows) {
    const n = toInteger(row['章'])
    if (n === undefined || n <= 0) continue
    ledger.push({
      n,
      title: row['标题'] ?? '',
      chars: toInteger(row['字数']),
      status: row['状态'] ?? '',
      summary: row['一句话摘要'] ?? '',
      cast: row['出场人物'] ?? '',
    })
  }
  ledger.sort((a, b) => a.n - b.n)

  const foreshadowTable = parseTable(foreshadowText, '编号')
  const foreshadows = []
  for (const row of foreshadowTable.rows) {
    const id = String(row['编号'] ?? '').trim()
    if (id === '') continue
    foreshadows.push({
      id,
      description: row['描述'] ?? '',
      level: row['层级'] ?? '',
      planted: toInteger(row['埋设章']),
      plan: toInteger(row['计划回收章']),
      actual: toInteger(row['实际回收章']),
      people: row['关联人物'] ?? '',
      status: String(row['状态'] ?? '').trim(),
    })
  }

  const decisionTable = parseTable(readText(join(dir, LAYOUT.decisions)) ?? '', '编号')
  const decisions = []
  for (const row of decisionTable.rows) {
    const id = String(row['编号'] ?? '').trim()
    if (id === '') continue
    decisions.push({
      id,
      date: row['日期'] ?? '',
      decision: row['决定'] ?? '',
      alternatives: row['备选'] ?? '',
      reason: row['理由'] ?? '',
      impact: impactChapters(row['影响章节']),
      status: String(row['状态'] ?? '').trim(),
    })
  }

  const chapters = listChapters(dir)
  const current = chapters.length === 0 ? 0 : chapters[chapters.length - 1].n
  const totalChars = chapters.reduce((sum, chapter) => sum + chapter.chars, 0)

  return {
    dir,
    title: projectTitle(brief),
    genre: projectGenre(brief),
    brief,
    world: readText(join(dir, LAYOUT.world)) ?? '',
    style: readText(join(dir, LAYOUT.style)) ?? '',
    glossary: readText(join(dir, LAYOUT.glossary)) ?? '',
    structure: readText(join(dir, LAYOUT.structure)) ?? '',
    volumes: readText(join(dir, LAYOUT.volumes)) ?? '',
    outlineText,
    ledgerText,
    foreshadowText,
    decisions,
    outline,
    ledger,
    foreshadows,
    characters: readCharacterCards(dir),
    chapters,
    current,
    totalChars,
    missing,
  }
}

/**
 * Chapter numbers a decision affects: `12`, `10-15`, `12、14`, `第 3–5 章`.
 * A range expands to every chapter inside it.
 */
export function impactChapters(raw) {
  const text = String(raw ?? '').replace(/[–—~～]/gu, '-')
  const chapters = new Set()
  for (const match of text.matchAll(/(\d+)\s*-\s*(\d+)/gu)) {
    const from = Number.parseInt(match[1], 10)
    const to = Number.parseInt(match[2], 10)
    for (let n = Math.min(from, to); n <= Math.max(from, to) && n <= Math.min(from, to) + 365; n += 1) chapters.add(n)
  }
  for (const match of text.replace(/\d+\s*-\s*\d+/gu, ' ').matchAll(/\d+/gu)) {
    chapters.add(Number.parseInt(match[0], 10))
  }
  return chapters
}

/* ------------------------------------------------------------------- audit */

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 }

function issue(severity, code, message, hint) {
  return { severity, code, message, ...hint === undefined ? {} : { hint } }
}

/**
 * Deterministic continuity audit. Returns issues ordered by severity and the
 * summary the caller renders. The checks encode the workflow's gates: an
 * unwritten outline row is fine, a written chapter without one is not.
 */
export function audit(project) {
  const issues = []
  const { current, outline, ledger, foreshadows, chapters } = project

  if (project.missing.length > 0) {
    issues.push(issue('error', 'CORE_FILE_MISSING', `缺少核心文件：${project.missing.join('、')}`, '用 novel_init 重新生成模板，或从备份恢复这些文件'))
  }

  for (const chapter of chapters) {
    if (!outline.some(row => row.n === chapter.n)) {
      issues.push(issue('error', 'CHAPTER_NO_OUTLINE', `第 ${chapter.n} 章已写正文，但章纲里没有这一章`, '先补章纲四节点再继续；没有细纲的正文最容易在后期返工'))
    }
  }

  const written = new Set(chapters.map(chapter => chapter.n))
  for (const row of outline) {
    if (row.n <= current && !written.has(row.n)) {
      issues.push(issue('info', 'OUTLINE_AHEAD', `章纲有第 ${row.n} 章，正文缺失`, '若该章已废弃，请在章纲删除并在结构变更日志登记'))
    }
    const next = outline.find(candidate => candidate.n === row.n + 1)
    if (next !== undefined && row.hook.trim() !== '' && next.answer.trim() === '') {
      issues.push(issue('warn', 'HOOK_UNANSWERED', `第 ${row.n} 章留了钩子，但第 ${row.n + 1} 章的回应对接为空`, '在下一章章纲里先填“回应对接”，再填钩子'))
    }
  }

  if (chapters.length > 0) {
    const max = current
    const present = new Set(chapters.map(chapter => chapter.n))
    for (let n = 1; n <= max; n += 1) {
      if (!present.has(n)) issues.push(issue('warn', 'CHAPTER_GAP', `第 ${n} 章正文缺失（章号不连续）`, '补写，或确认整章合并后更新章号与总表'))
    }
    for (const chapter of chapters) {
      const row = ledger.find(entry => entry.n === chapter.n)
      if (row === undefined) {
        issues.push(issue('warn', 'LEDGER_MISSING_ROW', `第 ${chapter.n} 章没有进总表`, '写完当章立即补总表：标题、状态、一句话摘要、出场人物'))
      }
    }
    for (const row of ledger) {
      if (row.n <= max && !present.has(row.n)) {
        issues.push(issue('warn', 'LEDGER_ROW_WITHOUT_CHAPTER', `总表有第 ${row.n} 章，正文文件不存在`, '补正文，或从总表删除该行'))
      }
    }
  }

  if (outline.length === 0) {
    issues.push(issue('warn', 'OUTLINE_EMPTY', '章纲为空：可以写设定，但不能开写正文', '先按章纲模板填未来 3–5 章的四节点'))
  }

  const open = foreshadows.filter(item => item.status !== '已收' && item.status !== '失效')
  for (const item of open) {
    if (item.plan === undefined) {
      issues.push(issue('warn', 'FORESHADOW_NO_PLAN', `伏笔 ${item.id} 没有计划回收章`, '在账本里补“计划回收章”，否则它不会被任何检查提醒'))
    } else if (item.plan <= current) {
      issues.push(issue('warn', 'FORESHADOW_OVERDUE', `伏笔 ${item.id}（${item.description || '无描述'}）计划在第 ${item.plan} 章回收，现已到第 ${current} 章`, '尽快安排回收，或改计划并在账本注明原因'))
    }
  }
  for (const item of foreshadows) {
    if (item.status === '已收' && item.actual === undefined) {
      issues.push(issue('info', 'FORESHADOW_NO_ACTUAL', `伏笔 ${item.id} 标为已收，但没写实际回收章`, '补“实际回收章”，方便日后检查对称性'))
    }
  }

  for (const row of outline) {
    const chapter = chapters.find(entry => entry.n === row.n)
    if (chapter === undefined || row.target === undefined || row.target <= 0) continue
    const drift = Math.abs(chapter.chars - row.target) / row.target
    if (drift > 0.5) {
      issues.push(issue('info', 'WORD_DRIFT', `第 ${row.n} 章 ${chapter.chars} 字，目标是 ${row.target} 字（偏差 ${Math.round(drift * 100)}%）`, '确认是节奏需要，还是该拆章/并章'))
    }
  }

  for (const card of project.characters) {
    const lastSeen = toInteger(card.lastSeen)
    if (lastSeen !== undefined && current - lastSeen > 15) {
      issues.push(issue('info', 'CHARACTER_STALE', `人物「${card.name}」最近出场在第 ${lastSeen} 章，已 ${current - lastSeen} 章没出现`, '要么安排出场，要么在设定里标为“暂退场”，避免读者遗忘'))
    }
  }

  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  const counts = { error: 0, warn: 0, info: 0 }
  for (const entry of issues) counts[entry.severity] += 1

  return {
    issues,
    counts,
    summary: {
      chapters: chapters.length,
      current,
      words: project.totalChars,
      outlineRows: outline.length,
      openForeshadows: open.length,
      overdueForeshadows: open.filter(item => item.plan !== undefined && item.plan <= current).length,
    },
  }
}

/* ------------------------------------------------------------------- brief */

function clip(text, limit) {
  const value = String(text ?? '').trim()
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}…`
}

function sectionLines(text, keywords, limit) {
  const lines = String(text ?? '')
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
    .filter(line => !/[：:]\s*$/u.test(line))
  const hits = lines.filter(line => keywords.some(keyword => line.includes(keyword)))
  return hits.slice(0, limit).map(line => clip(line.replace(/^[-*]\s*/u, ''), 160))
}

/**
 * Build one bounded chapter brief: what to write, who is in it, which
 * foreshadows are due, and the style constraints. Pure and deterministic, so
 * the same project always yields the same brief.
 */
export function buildBrief(project, chapterNumber, maxChars = 3500) {
  const row = project.outline.find(item => item.n === chapterNumber)
  const parts = []
  const push = text => parts.push(text)

  push(`# 第 ${chapterNumber} 章 上下文卡`)
  push(`- 作品：${project.title || '（未命名）'}${project.genre === '' ? '' : ` · ${project.genre}`}`)
  push(`- 进度：已写 ${project.chapters.length} 章 / 共 ${project.totalChars} 字；本章目标 ${row?.target ?? '未设'} 字`)

  if (row === undefined) {
    push('')
    push('> 本章还没有章纲。按铁律，先补细纲再写正文。')
  } else {
    push('')
    push('## 本章细纲')
    push(`- POV：${row.pov || '未指定'}`)
    push(`- 目标：${row.goal || '（空）'}`)
    push(`- 转折：${row.turn || '（空）'}`)
    push(`- 钩子：${row.hook || '（空）'}`)
    push(`- 回应对接：${row.answer || '（空）'}`)
    push(`- 伏笔：${row.foreshadow || '（无）'}`)
  }

  const relevantDecisions = project.decisions
    .filter(item => item.status !== '失效' && item.impact.has(chapterNumber))
    .slice(0, 6)
  if (relevantDecisions.length > 0) {
    push('')
    push('## 本章相关决定')
    for (const item of relevantDecisions) {
      const parts = [clip(item.decision, 90)]
      if (item.reason !== '') parts.push(`理由：${clip(item.reason, 90)}`)
      if (item.alternatives !== '') parts.push(`备选：${clip(item.alternatives, 60)}`)
      push(`- ${item.id}：${parts.join('；')}`)
    }
  }

  const previous = project.ledger
    .filter(entry => entry.n < chapterNumber)
    .slice(-2)
  if (previous.length > 0) {
    push('')
    push('## 前情（最近两章）')
    for (const entry of previous) {
      push(`- 第 ${entry.n} 章${entry.title === '' ? '' : `《${entry.title}》`}：${clip(entry.summary || '（总表缺摘要）', 220)}`)
    }
  }

  const cast = new Set()
  if (row !== undefined) {
    for (const name of `${row.pov}`.split(/[、,，/;；\s]+/u)) {
      if (name !== '') cast.add(name)
    }
  }
  const relevant = project.characters.filter(card => cast.has(card.name) || card.aliases.split(/[、,，/;；\s]+/u).some(alias => cast.has(alias)))
  const cards = relevant.length > 0 ? relevant : project.characters.filter(card => card.name === '主角').slice(0, 1)
  if (cards.length > 0) {
    push('')
    push('## 在场人物（当前状态）')
    for (const card of cards) {
      const line = [
        card.motivation === '' ? '' : `动机：${clip(card.motivation, 80)}`,
        card.goal === '' ? '' : `目标：${clip(card.goal, 80)}`,
        card.flaw === '' ? '' : `缺陷：${clip(card.flaw, 60)}`,
        card.voice === '' ? '' : `口吻：${clip(card.voice, 60)}`,
      ].filter(Boolean)
      push(`- ${card.name}${card.fullName === '' ? '' : `（${card.fullName}）`}${line.length === 0 ? '' : ` —— ${line.join('；')}`}`)
    }
  }

  const due = project.foreshadows
    .filter(item => item.status !== '已收' && item.status !== '失效')
    .filter(item => (item.plan !== undefined && item.plan <= chapterNumber + 2) || item.planted === chapterNumber)
    .slice(0, 6)
  if (due.length > 0) {
    push('')
    push('## 待处理伏笔')
    for (const item of due) {
      push(`- ${item.id}（${item.level || '未分层'}）：${clip(item.description, 100)}；计划第 ${item.plan ?? '?'} 章回收${item.planted === chapterNumber ? '；本章埋设' : ''}`)
    }
  }

  const constraints = sectionLines(project.world, ['不能', '禁止', '禁忌', '代价', '规则'], 5)
  if (constraints.length > 0) {
    push('')
    push('## 世界规则与禁忌')
    for (const line of constraints) push(`- ${line}`)
  }

  const styleLines = sectionLines(project.style, ['视角', '句式', '用词', '禁忌', '样本', '节奏'], 6)
  if (styleLines.length > 0) {
    push('')
    push('## 文风约束')
    for (const line of styleLines) push(`- ${line}`)
  }

  push('')
  push('## 工作材料')
  push('- 决策记录：06-工作台/决策记录.md（影响本章的已列在上面）')
  push('- 试写与废稿：06-工作台/草稿/（不参与字数统计与 novel_check）')
  push('- 素材：06-工作台/素材.md；审校报告：06-工作台/审校报告/')

  push('')
  push('## 本章底线')
  push('- 场景必须有目标—冲突—转折；没有转折的场景删掉。')
  push('- 不写读者此刻不知道的信息；角色不能说出他还不该知道的事。')
  push('- 写完立刻更新总表与伏笔账本，再跑 novel_check。')

  let text = parts.join('\n')
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n\n…[上下文卡已截断，完整信息见项目文件]`
  }
  return text
}
