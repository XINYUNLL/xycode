#!/usr/bin/env node
// eval harness —— 迷你 SWE-bench（移植自 xy_coding_agent）。
//
// 对每道题：在干净的工作区里跑 xycode agent → 用 Node 确定性判卷 → 采集指标。
// 判卷不靠「LLM 当裁判」，而是每个 task 的 verify 是一个 Node 布尔表达式。

import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Agent } from '../dist/agent.js'

// ─── 加载 .env（repo 根目录），供 Agent 拿到 API key / 代理地址 ───
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)

function loadEnv() {
  const envPath = join(REPO, '.env')
  if (!existsSync(envPath)) return
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && !(key in process.env)) process.env[key] = value
  }
}
loadEnv()

const TASKS_DIR = join(HERE, 'tasks')
const WORKSPACE_ROOT = join(HERE, '.workspace')
const RESULTS_FILE = join(HERE, 'results.jsonl')

function loadTasks(filter) {
  return readdirSync(TASKS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(TASKS_DIR, f), 'utf8')))
    .filter((t) => filter.length === 0 || filter.includes(t.id))
}

// 判卷引擎用 Node 直接跑（不经 shell），规避 Windows 下 bash 找不到 node 的 PATH 问题。
function runVerify(verify, cwd) {
  const code = `try { process.exit((${verify}) ? 0 : 1) } catch { process.exit(1) }`
  try {
    execFileSync(process.execPath, ['-e', code], { cwd, timeout: 30_000, encoding: 'utf8' })
    return 0
  } catch (e) {
    return e.status ?? -1
  }
}

// 测试脚本判卷：把脚本写到工作区再跑（agent 看不到，只在判卷时生成），
// 脚本 exit 0 = 过，非 0 = 挂。适合实现类任务（多断言、多边界条件）。
function runTest(testScript, cwd) {
  const file = join(cwd, '_eval_verify.js')
  writeFileSync(file, testScript)
  try {
    execFileSync(process.execPath, [file], { cwd, timeout: 30_000, encoding: 'utf8' })
    return 0
  } catch (e) {
    return e.status ?? -1
  } finally {
    rmSync(file, { force: true })
  }
}

async function main() {
  const filter = process.argv.slice(2)
  const tasks = loadTasks(filter)
  if (tasks.length === 0) {
    console.log('没有找到任务。用法: npm run eval -- [task_id ...]')
    process.exit(1)
  }

  const model = process.env.EVAL_MODEL ?? 'claude-sonnet-4-6'
  const rootCwd = process.cwd()

  console.log(`开始评测：${tasks.length} 道题，模型 = ${model}\n`)

  const records = []
  for (const task of tasks) {
    const ws = join(WORKSPACE_ROOT, task.id)
    rmSync(ws, { recursive: true, force: true })
    mkdirSync(ws, { recursive: true })
    // 工作区固定为 CommonJS，让 agent 写的 .js 能用 require/module.exports
    // （否则会被项目根 package.json 的 "type":"module" 影响）
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ type: 'commonjs' }))
    for (const [name, content] of Object.entries(task.fixtures ?? {})) {
      writeFileSync(join(ws, name), content)
    }

    console.log(`── ${task.id}｜${task.name}`)

    process.chdir(ws)
    const agent = new Agent({
      model,
      permissionMode: 'bypassPermissions', // 放行写文件/普通 shell，危险命令仍拦截
      maxTurns: 30,
      apiKey: process.env.ANTHROPIC_API_KEY,
      anthropicBaseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    })
    await agent.chat(task.prompt)
    const numTurns = agent.numTurns
    const totalCostUsd = agent.totalCostUsd
    await agent.close()
    process.chdir(rootCwd)

    const testFile = join(TASKS_DIR, `${task.id}.test.js`)
    const verifyExitCode = existsSync(testFile)
      ? runTest(readFileSync(testFile, 'utf8'), ws)
      : runVerify(task.verify, ws)
    const pass = verifyExitCode === 0

    const record = { taskId: task.id, taskName: task.name, pass, verifyExitCode, numTurns, totalCostUsd }
    records.push(record)
    appendFileSync(RESULTS_FILE, JSON.stringify(record) + '\n')

    console.log(
      `    → ${pass ? '✅ PASS' : '❌ FAIL'}  (verify exit=${verifyExitCode}, 轮数=${numTurns}, 成本=$${totalCostUsd.toFixed(4)})\n`,
    )
  }

  const passCount = records.filter((r) => r.pass).length
  const totalCost = records.reduce((s, r) => s + r.totalCostUsd, 0)
  const avgTurns = records.reduce((s, r) => s + r.numTurns, 0) / records.length

  console.log('══════════════ 汇总 ══════════════')
  console.log(`解决率：${passCount}/${records.length} = ${Math.round((passCount / records.length) * 100)}%`)
  console.log(`总成本：$${totalCost.toFixed(4)}`)
  console.log(`平均轮数：${avgTurns.toFixed(1)}`)
  console.log()
  console.table(
    records.map((r) => ({
      任务: r.taskId,
      结果: r.pass ? 'PASS' : 'FAIL',
      轮数: r.numTurns,
      成本: `$${r.totalCostUsd.toFixed(4)}`,
    })),
  )
}

main().catch((e) => {
  console.error('评测运行失败:', e)
  process.exit(1)
})
