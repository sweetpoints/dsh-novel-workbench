/**
 * Offline tests for the project model: scaffolding, parsing, audit, and brief.
 * Run with `node test/test.mjs`; nothing is installed and no model is called.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm, appendFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scaffoldNovel } from '../index.js'
import { audit, buildBrief, impactChapters, loadProject, LAYOUT } from '../lib/project.js'

const root = await mkdtemp(join(tmpdir(), 'novel-workbench-test-'))
let failures = 0

async function step(name, run) {
  try {
    await run()
    console.log(`ok   ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${name}\n     ${error.message}`)
  }
}

try {
  await step('scaffold writes the fixed tree and substitutes variables', async () => {
    const created = await scaffoldNovel(root, {
      TITLE: '测试长篇',
      GENRE: '悬疑',
      DATE: '2026-11-28',
      VOLUMES: '3',
      CHAPTER_WORDS: '1200',
      PROTAGONIST: '林岸',
      ANTAGONIST: '周岐',
    })
    assert.equal(created.length, 20)
    for (const relative of created) {
      assert.ok(existsSync(join(root, relative)), `missing ${relative}`)
    }
    const brief = await import('node:fs/promises').then(fs => fs.readFile(join(root, LAYOUT.brief), 'utf8'))
    assert.match(brief, /测试长篇/)
    assert.match(brief, /悬疑/)
  })

  await step('append one outlined chapter, one ledger row, and two foreshadows', async () => {
    await appendFile(join(root, LAYOUT.outline), [
      '| 1 | 主角 | 拿回借条 | 被赶出家门 | 借条被撕 | （开篇） | F001 埋 | 1200 |',
      '| 2 | 主角 | 找到证人 | 证人翻供 | 证人失踪 |  | F002 埋 | 1200 |',
      '',
    ].join('\n'))
    await appendFile(join(root, LAYOUT.ledger), [
      '| 1 | 雨夜 | 220 | 草稿 | 林岸被赶出家门，借条被撕。 | 林岸 |',
      '',
    ].join('\n'))
    await appendFile(join(root, LAYOUT.foreshadow), [
      '| F001 | 借条背面的电话号码 | 中 | 1 | 1 |  | 林岸 | 未收 |',
      '| F002 | 证人手上的疤 | 表 | 2 |  |  | 证人 | 未收 |',
      '',
    ].join('\n'))
    const briefPath = join(root, LAYOUT.brief)
    const premise = (await import('node:fs/promises')).readFile(briefPath, 'utf8')
    const premiseText = await premise
    await (await import('node:fs/promises')).writeFile(
      briefPath,
      premiseText.replace('## 一句话故事（≤15 字，不含人名）', '## 一句话故事（≤15 字，不含人名）\n\n一个记者追查父亲死因。'),
      'utf8',
    )
    const volumePath = join(root, '02-结构/卷纲.md')
    const volumeText = await (await import('node:fs/promises')).readFile(volumePath, 'utf8')
    await (await import('node:fs/promises')).writeFile(
      volumePath,
      volumeText.replace('| 1 |  |  |  |  |', '| 1 | 1-12 | 借条与身世 | 拿到借条 | 证人失踪 |'),
      'utf8',
    )
    await (await import('node:fs/promises')).writeFile(
      join(root, '02-结构/细纲/第001章.md'),
      '## 场次\n\n1. 雨夜门口：林岸要借条，被赶走。\n',
      'utf8',
    )
    await appendFile(join(root, LAYOUT.decisions), [
      '| 2026-11-28 | D001 | 视角锁定主角 | 双 POV 交替 | 读者必须与他同步才知道借条存在 | 1-2 | 生效 |',
      '',
    ].join('\n'))
    const text = '林岸站在雨里，借条在指间碎成两半。\n'.repeat(12)
    await writeFile(join(root, LAYOUT.chapters, '第001章.md'), text, 'utf8')
  })

  await step('loadProject reads chapters, outline, ledger, foreshadows, and characters', async () => {
    const project = await loadProject(root)
    assert.equal(project.title, '测试长篇')
    assert.equal(project.genre, '悬疑')
    assert.equal(project.chapters.length, 1)
    assert.equal(project.current, 1)
    assert.ok(project.totalChars > 100)
    assert.equal(project.outline.length, 2)
    assert.equal(project.ledger.length, 1)
    assert.equal(project.foreshadows.length, 2)
    assert.equal(project.foreshadows[0].plan, 1)
    assert.equal(project.characters.length, 2)
    assert.equal(project.decisions.length, 1)
    assert.ok(project.decisions[0].impact.has(2), 'range 1-2 should cover chapter 2')
    assert.equal(project.missing.length, 0)
  })

  await step('audit flags the unanswered hook, overdue pay-off, and missing plan', async () => {
    const project = await loadProject(root)
    const report = audit(project)
    const codes = report.issues.map(entry => entry.code)
    assert.ok(codes.includes('HOOK_UNANSWERED'), `codes: ${codes.join(',')}`)
    assert.ok(codes.includes('FORESHADOW_OVERDUE'), `codes: ${codes.join(',')}`)
    assert.ok(codes.includes('FORESHADOW_NO_PLAN'), `codes: ${codes.join(',')}`)
    assert.equal(report.counts.error, 0)
    assert.ok(report.counts.warn >= 3)
    assert.equal(report.summary.chapters, 1)
    assert.equal(report.summary.overdueForeshadows, 1)
  })

  await step('audit flags a written chapter with no outline row', async () => {
    await writeFile(join(root, LAYOUT.chapters, '第003章.md'), '孤儿章节。', 'utf8')
    const project = await loadProject(root)
    const report = audit(project)
    const errors = report.issues.filter(entry => entry.severity === 'error')
    assert.ok(errors.some(entry => entry.code === 'CHAPTER_NO_OUTLINE' && entry.message.includes('第 3 章')))
    // Chapter 2 is missing, so the gap is reported too.
    assert.ok(report.issues.some(entry => entry.code === 'CHAPTER_GAP' && entry.message.includes('第 2 章')))
  })

  await step('buildBrief is bounded and contains the working material', async () => {
    await rm(join(root, LAYOUT.chapters, '第003章.md'))
    const project = await loadProject(root)
    const text = buildBrief(project, 1, 3500)
    assert.ok(text.includes('# 第 1 章 上下文卡'))
    assert.ok(text.includes('拿回借条'))
    assert.ok(text.includes('林岸'))
    assert.ok(text.includes('F001'))
    assert.ok(text.includes('D001'), 'brief should carry the decision that affects the chapter')
    assert.ok(text.includes('## 上游约束'), 'brief should carry upstream constraints')
    assert.ok(text.includes('一个记者追查父亲死因'), 'brief should carry the book premise')
    assert.ok(text.includes('借条与身世'), 'brief should carry the volume conflict')
    assert.ok(text.includes('### 场次细纲'), 'brief should inline the per-chapter fine outline')
    assert.ok(text.includes('雨夜门口'), 'fine outline content missing')
    assert.ok(!text.includes('三句话里第三句'), 'template notes leaked into the brief')
    assert.ok(text.includes('决策记录'))
    assert.ok(text.length <= 3500 + 40)
  })

  await step('skill keeps its detail behind pointers', async () => {
    const fs = await import('node:fs/promises')
    const skillDir = join(import.meta.dirname, '..', 'skill')
    const main = await fs.readFile(join(skillDir, 'novel-workflow.md'), 'utf8')
    for (const pointer of ['reference/structure.md', 'reference/continuity.md', 'reference/revision.md']) {
      assert.ok(main.includes(pointer), `missing pointer ${pointer}`)
      assert.ok(existsSync(join(skillDir, pointer)), `missing file ${pointer}`)
    }
    assert.ok(main.length < 4000, `top-level skill grew to ${main.length} chars`)
  })

  await step('parseTable tolerates padded cells and extra columns', async () => {
    const project = await loadProject(root)
    assert.equal(project.outline[1].turn, '证人翻供')
    assert.equal(project.outline[1].answer, '')
    assert.equal(project.outline[1].target, 1200)
    assert.deepEqual([...impactChapters('第 3–5 章')].sort((a, b) => a - b), [3, 4, 5])
  })
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nall tests passed')
}
