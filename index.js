/**
 * Long-novel workbench for DeepSeek Harness.
 *
 * Four model-facing tools around one fixed project layout:
 *   novel_init   scaffold the directory tree from templates
 *   novel_status progress, next chapter, and the next actions
 *   novel_check  continuity audit (gates, ledger sync, foreshadows, hooks)
 *   novel_brief  one bounded chapter brief built from the project files
 *
 * Plus a loadable `novel-workflow` skill with the staged method. The tools are
 * deterministic file readers/writers: they never call a model and never decide
 * story content.
 *
 * @module @sweetpoints/dsh-novel-workbench
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SCAFFOLD,
  audit,
  buildBrief,
  loadProject,
  LAYOUT,
} from './lib/project.js'

export const name = 'tool-novel'
export const inject = ['tools', 'workingDirectory']

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES = join(HERE, 'templates')
const DEFAULT_CHAPTER_WORDS = 3000
const DEFAULT_VOLUMES = 5

/* ------------------------------------------------------------------ helpers */

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(args, key) {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`invalid ${key}: expected a non-empty string`)
  }
  return value
}

function optionalInteger(args, key, min, max) {
  const value = args[key]
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`invalid ${key}: expected an integer from ${min} to ${max}`)
  }
  return value
}

async function sessionDirectory(ctx, exec) {
  if (exec.agent !== undefined) {
    try {
      return await ctx.workingDirectory.ensure(exec.agent, exec.signal)
    } catch {
      // Fall back to the deployment directory; an unusable session directory
      // should not turn a read-only status call into a failure.
    }
  }
  return ctx.workingDirectory.defaultDirectory
}

async function projectDirectory(ctx, exec, requested) {
  const cwd = await sessionDirectory(ctx, exec)
  return requested === undefined ? cwd : resolve(cwd, requested)
}

function today() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function defaultDirectoryName(title) {
  const cleaned = String(title)
    .replace(/[\\/:*?"<>|\r\n\t]+/gu, '-')
    .replace(/^[\s.-]+|[\s.-]+$/gu, '')
    .replace(/-{2,}/gu, '-')
    .slice(0, 60)
  return cleaned === '' ? '长篇小说' : cleaned
}

function number(value) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

/* --------------------------------------------------------------- scaffolding */

/** Write the fixed project tree from templates. Returns the created files. */
export async function scaffoldNovel(dir, vars = {}, templatesDir = TEMPLATES) {
  const created = []
  for (const relative of SCAFFOLD) {
    const source = await readFile(join(templatesDir, relative), 'utf8')
    const content = source.replace(/\{\{([A-Z_]+)\}\}/gu, (_match, key) => String(vars[key] ?? ''))
    const target = join(dir, relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
    created.push(relative)
  }
  await mkdir(join(dir, LAYOUT.chapters), { recursive: true })
  return created
}

/* -------------------------------------------------------------- next actions */

function nextActions(project, report) {
  const actions = []
  const current = project.current
  const next = current + 1
  const missingNext = !project.outline.some(row => row.n === next)

  if (report.counts.error > 0) {
    const first = report.issues.find(entry => entry.severity === 'error')
    actions.push(`先消除 error：${first.message}`)
  }
  if (project.outline.length === 0) {
    actions.push('章纲为空：先补第 1 章的四节点（目标/转折/钩子/回应对接）')
  } else if (current === 0) {
    actions.push('从 novel_brief chapter=1 生成本章上下文卡，再写正文')
  } else if (missingNext) {
    actions.push(`补第 ${next} 章细纲，再继续写`)
  } else {
    actions.push(`用 novel_brief chapter=${next} 生成本章上下文卡`)
  }
  if (report.summary.overdueForeshadows > 0) {
    actions.push(`有 ${report.summary.overdueForeshadows} 条超期伏笔：安排回收或改计划章`)
  }
  const last = project.ledger.find(entry => entry.n === current)
  if (current > 0 && last === undefined) {
    actions.push(`补第 ${current} 章总表行（标题/状态/摘要/出场人物）`)
  } else if (current > 0 && last !== undefined && last.status !== '定稿') {
    actions.push(`审校第 ${current} 章（总表状态：${last.status || '空'}）`)
  }
  return actions.slice(0, 5)
}

/* ------------------------------------------------------------------ renders */

function renderInit(value) {
  const lines = [
    `已建立项目「${value.title}」：${value.dir}`,
    '',
    `- 模板文件：${value.created.length} 个（设定 / 结构 / 追踪 / 审校）`,
    `- 正文目录：${value.chapterDir}（文件名固定为 第001章.md）`,
    '',
    '下一步：先写 `00-立项.md` 的一句话故事与核心冲突，再补第 1 章章纲，然后 `novel_brief chapter=1`。',
  ]
  return [{ type: 'text', text: lines.join('\n') }]
}

function renderStatus(value) {
  const lines = [
    `# ${value.title || '（未命名）'}${value.genre ? ` · ${value.genre}` : ''}`,
    `项目：${value.dir}`,
    '',
    `- 正文：${value.chapters} 章 / ${number(value.words)} 字`,
    value.lastChapter.n === 0 ? '- 最近一章：尚无' : `- 最近一章：第 ${value.lastChapter.n} 章${value.lastChapter.title ? `《${value.lastChapter.title}》` : ''}（${value.lastChapter.status || '未标状态'}）`,
    `- 章纲：${value.outlineRows} 行；下一章：第 ${value.nextChapter} 章${value.nextPlanned ? '' : '（章纲缺）'}`,
    `- 伏笔：${value.openForeshadows} 条未收，${value.overdueForeshadows} 条超期`,
  ]
  if (value.missing.length > 0) {
    lines.push('', `⚠ 缺失文件：${value.missing.join('、')}`)
  }
  lines.push('', '## 下一步')
  value.nextActions.forEach((action, index) => lines.push(`${index + 1}. ${action}`))
  return [{ type: 'text', text: lines.join('\n') }]
}

function renderCheck(value) {
  const lines = [
    `# 审校：${value.title || '（未命名）'}`,
    `error ${value.counts.error} · warn ${value.counts.warn} · info ${value.counts.info}`,
    '',
  ]
  if (value.issues.length === 0) {
    lines.push('没有发现问题。')
  } else {
    for (const entry of value.issues) {
      lines.push(`- **[${entry.severity}] ${entry.code}** ${entry.message}${entry.hint ? `\n  → ${entry.hint}` : ''}`)
    }
    if (value.truncated) lines.push('', `…还有 ${value.hidden} 条未显示；调大 limit 查看。`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

function renderBrief(value) {
  return [{ type: 'text', text: value.text }]
}

/* -------------------------------------------------------------------- tools */

export function createTools(ctx) {
  const initTool = {
    name: 'novel_init',
    description: 'Scaffold a long-novel project: a fixed Markdown tree for premise, world, style, characters, outline, volume plan, chapter ledger, foreshadowing ledger, revision checklist, and a working folder (decision log, material, drafts, audit reports). Refuses a non-empty directory. Then fill 00-立项.md, add chapter-outline rows, and call novel_brief.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '书名，写入 00-立项.md，并作为默认目录名。' },
        dir: { type: 'string', description: '项目目录，相对当前会话工作目录；省略时用书名建一个子目录。' },
        genre: { type: 'string', description: '类型/题材，例如 悬疑、科幻、东方玄幻、都市言情。默认“未定”。' },
        volumes: { type: 'integer', description: '计划卷数，1–100，默认 5。' },
        chapterWords: { type: 'integer', description: '单章目标字数，500–20000，默认 3000。' },
      },
      required: ['title'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string' },
          title: { type: 'string' },
          created: { type: 'array', items: { type: 'string' } },
          chapterDir: { type: 'string' },
        },
        required: ['dir', 'title', 'created', 'chapterDir'],
      },
      render: (_args, value) => renderInit(value),
    },
    async execute(args, exec) {
      if (!isRecord(args)) throw new Error('invalid arguments: expected an object')
      const title = optionalString(args, 'title')
      if (title === undefined) throw new Error('`title` is required')
      const requestedDir = optionalString(args, 'dir')
      const genre = optionalString(args, 'genre') ?? '未定'
      const volumes = optionalInteger(args, 'volumes', 1, 100) ?? DEFAULT_VOLUMES
      const chapterWords = optionalInteger(args, 'chapterWords', 500, 20_000) ?? DEFAULT_CHAPTER_WORDS
      const cwd = await sessionDirectory(ctx, exec)
      const dir = resolve(cwd, requestedDir ?? defaultDirectoryName(title))

      if (existsSync(dir)) {
        const entries = await readdir(dir)
        if (entries.length > 0) {
          throw new Error(`target directory is not empty: ${dir}. Pick another dir, or move the existing files first.`)
        }
      }

      const created = await scaffoldNovel(dir, {
        TITLE: title,
        GENRE: genre,
        DATE: today(),
        VOLUMES: String(volumes),
        CHAPTER_WORDS: String(chapterWords),
        PROTAGONIST: '（待定）',
        ANTAGONIST: '（待定）',
      })
      return {
        dir,
        title,
        created,
        chapterDir: join(dir, LAYOUT.chapters),
      }
    },
  }

  const statusTool = {
    name: 'novel_status',
    description: 'Read a project and report progress: chapters and words, the last chapter, the next chapter and whether its outline row exists, open and overdue foreshadows, missing files, and the next actions. Read-only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dir: { type: 'string', description: '项目根目录（含 00-立项.md），相对当前会话工作目录；省略时用当前工作目录。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string' },
          title: { type: 'string' },
          genre: { type: 'string' },
          chapters: { type: 'integer' },
          words: { type: 'integer' },
          outlineRows: { type: 'integer' },
          nextChapter: { type: 'integer' },
          nextPlanned: { type: 'boolean' },
          openForeshadows: { type: 'integer' },
          overdueForeshadows: { type: 'integer' },
          lastChapter: { type: 'object' },
          missing: { type: 'array', items: { type: 'string' } },
          nextActions: { type: 'array', items: { type: 'string' } },
        },
        required: ['dir', 'title', 'genre', 'chapters', 'words', 'outlineRows', 'nextChapter', 'nextPlanned', 'openForeshadows', 'overdueForeshadows', 'lastChapter', 'missing', 'nextActions'],
      },
      render: (_args, value) => renderStatus(value),
    },
    async execute(args, exec) {
      if (!isRecord(args)) throw new Error('invalid arguments: expected an object')
      const dir = await projectDirectory(ctx, exec, optionalString(args, 'dir'))
      const project = await loadProject(dir)
      const report = audit(project)
      const last = project.ledger.find(entry => entry.n === project.current)
      const nextChapter = project.current + 1
      return {
        dir,
        title: project.title,
        genre: project.genre,
        chapters: project.chapters.length,
        words: project.totalChars,
        outlineRows: project.outline.length,
        nextChapter,
        nextPlanned: project.outline.some(row => row.n === nextChapter),
        openForeshadows: project.foreshadows.filter(item => item.status !== '已收' && item.status !== '失效').length,
        overdueForeshadows: report.summary.overdueForeshadows,
        lastChapter: {
          n: project.current,
          title: last?.title ?? '',
          status: last?.status ?? '',
          chars: project.chapters[project.chapters.length - 1]?.chars ?? 0,
        },
        missing: project.missing,
        nextActions: nextActions(project, report),
      }
    },
  }

  const checkTool = {
    name: 'novel_check',
    description: 'Audit a project for continuity defects: chapters without an outline row, chapter-number gaps, ledger rows that do not match chapter files, unanswered chapter hooks, foreshadows that are overdue or have no planned pay-off, word-count drift, and characters absent for too long. Returns issues with severity, code, message, and a fix hint.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dir: { type: 'string', description: '项目根目录，相对当前会话工作目录；省略时用当前工作目录。' },
        limit: { type: 'integer', description: '最多返回多少条问题，1–100，默认 40；按 error → warn → info 排序。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string' },
          title: { type: 'string' },
          counts: { type: 'object' },
          issues: { type: 'array', items: { type: 'object' } },
          truncated: { type: 'boolean' },
          hidden: { type: 'integer' },
        },
        required: ['dir', 'title', 'counts', 'issues', 'truncated', 'hidden'],
      },
      render: (_args, value) => renderCheck(value),
    },
    async execute(args, exec) {
      if (!isRecord(args)) throw new Error('invalid arguments: expected an object')
      const dir = await projectDirectory(ctx, exec, optionalString(args, 'dir'))
      const limit = optionalInteger(args, 'limit', 1, 100) ?? 40
      const project = await loadProject(dir)
      const report = audit(project)
      return {
        dir,
        title: project.title,
        counts: report.counts,
        issues: report.issues.slice(0, limit),
        truncated: report.issues.length > limit,
        hidden: Math.max(0, report.issues.length - limit),
      }
    },
  }

  const briefTool = {
    name: 'novel_brief',
    description: 'Build one bounded chapter brief from the project files: the chapter outline row, the previous two chapters\' summaries, the current state of the POV characters, foreshadows due within two chapters, world rules and taboos, and the style constraints. Use it before writing a chapter so the context is fixed-size instead of the whole manuscript.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dir: { type: 'string', description: '项目根目录，相对当前会话工作目录；省略时用当前工作目录。' },
        chapter: { type: 'integer', description: '章号，1–10000；省略时取当前已写最大章号 + 1。' },
        maxChars: { type: 'integer', description: '上下文卡总长度上限（字符），800–12000，默认 3500。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chapter: { type: 'integer' },
          chars: { type: 'integer' },
          text: { type: 'string' },
        },
        required: ['chapter', 'chars', 'text'],
      },
      render: (_args, value) => renderBrief(value),
    },
    async execute(args, exec) {
      if (!isRecord(args)) throw new Error('invalid arguments: expected an object')
      const dir = await projectDirectory(ctx, exec, optionalString(args, 'dir'))
      const requested = optionalInteger(args, 'chapter', 1, 10_000)
      const maxChars = optionalInteger(args, 'maxChars', 800, 12_000) ?? 3500
      const project = await loadProject(dir)
      const chapter = requested ?? project.current + 1
      const text = buildBrief(project, chapter, maxChars)
      return { chapter, chars: text.length, text }
    },
  }

  return [initTool, statusTool, checkTool, briefTool]
}

/* -------------------------------------------------------------------- skill */

function readSkill() {
  try {
    return readFileSync(join(HERE, 'skill', 'novel-workflow.md'), 'utf8')
  } catch {
    return undefined
  }
}

function registerSkill(ctx) {
  const skills = ctx.get('skills')
  if (skills === undefined) return
  const content = readSkill()
  if (content === undefined) return
  try {
    skills.register({
      name: 'novel-workflow',
      description: 'Long-novel workflow for planning, drafting, and revising 长篇/连载/系列: rolling chapter outlines, a fixed-size chapter brief, continuity checks, and three revision passes.',
      whenToUse: 'Use when planning, outlining, drafting, or revising a long novel, serial, or series, especially with the novel_* tools or when continuity across dozens of chapters matters.',
      content,
      source: 'custom',
      resourceBase: { kind: 'directory', path: join(HERE, 'skill') },
    })
  } catch {
    // A duplicate name from another plugin must not disable the tools.
  }
}

/* -------------------------------------------------------------------- entry */

export function apply(ctx) {
  for (const tool of createTools(ctx)) ctx.tools.register(tool)
  registerSkill(ctx)
}
