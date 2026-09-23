#!/usr/bin/env node
// 持久记忆 MCP server over stdio（raw JSON-RPC，无 SDK 依赖）。
// 逻辑移植自 xy_coding_agent 的 memory-server。
//
// 工具：
//   - add_note：记一条笔记（跨会话保留）
//   - list_notes：读取最近的笔记
//
// 笔记存到 ~/.xycode-memory.json（可用 MEMORY_FILE 环境变量覆盖）。
// 注意：stdio server 只能往 stdout 写 JSON-RPC 消息，不能 console.log，否则协议会坏。

import readline from 'node:readline'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const rl = readline.createInterface({ input: process.stdin, terminal: false })

const NOTES_FILE = process.env.MEMORY_FILE || join(homedir(), '.xycode-memory.json')

const TOOLS = [
  {
    name: 'add_note',
    description:
      '把一条文本记到持久化笔记里（跨会话保留）。适合记录「用户偏好」「上次结论」「待办」等需要长期记住的内容。',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: '要记住的内容' } },
      required: ['text'],
    },
  },
  {
    name: 'list_notes',
    description: '读取最近的笔记（默认最近 10 条，倒序）。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: '最多返回多少条，默认 10' } },
    },
  },
]

function loadNotes() {
  if (!existsSync(NOTES_FILE)) return []
  try {
    return JSON.parse(readFileSync(NOTES_FILE, 'utf8'))
  } catch {
    return []
  }
}

function saveNotes(notes) {
  mkdirSync(dirname(NOTES_FILE), { recursive: true })
  writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2))
}

function handleRequest(req) {
  const { method, params, id } = req

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'memory', version: '1.0.0' },
      },
    }
  }
  if (method === 'notifications/initialized') return null

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
  }

  if (method === 'tools/call') {
    const args = params.arguments || {}
    try {
      if (params.name === 'add_note') {
        const notes = loadNotes()
        notes.push({ time: new Date().toISOString(), text: args.text })
        saveNotes(notes)
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `已记住（共 ${notes.length} 条）：${args.text}` }] },
        }
      }
      if (params.name === 'list_notes') {
        const limit = args.limit ?? 10
        const notes = loadNotes()
        const recent = notes.slice(-limit).reverse()
        if (recent.length === 0) {
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '（还没有任何笔记）' }] } }
        }
        const text = recent.map((n) => `- ${n.time}: ${n.text}`).join('\n')
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } }
      }
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${params.name}` } }
    } catch (e) {
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `错误：${e.message}` }], isError: true },
      }
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } }
}

rl.on('line', (line) => {
  try {
    const resp = handleRequest(JSON.parse(line.trim()))
    if (resp) process.stdout.write(JSON.stringify(resp) + '\n')
  } catch {
    // 忽略无法解析的行
  }
})
