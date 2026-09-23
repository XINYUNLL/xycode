#!/usr/bin/env node
// GitHub MCP server over stdio (raw JSON-RPC, no SDK dependency).
// 逻辑移植自 xy_coding_agent 的 github-server，只是把传输层从
// @modelcontextprotocol/sdk 换成了手写 JSON-RPC，与 test/mcp-server.cjs 一致。
//
// 工具：
//   - create_repo：用 GitHub API 建仓库
//   - push_current_repo：把当前项目 git init/add/commit/push 到 GitHub
//
// 鉴权：GITHUB_TOKEN（Personal Access Token，repo 权限），由上层通过 env 传入。
// 目标目录：AGENT_CWD（agent 工作目录），默认继承当前进程 cwd。

import readline from 'node:readline'
import { execFileSync } from 'node:child_process'

const rl = readline.createInterface({ input: process.stdin, terminal: false })

const TOKEN = process.env.GITHUB_TOKEN || ''
const TARGET_DIR = process.env.AGENT_CWD || process.cwd()

const TOOLS = [
  {
    name: 'create_repo',
    description: '在 GitHub 上创建一个新仓库（需要 GITHUB_TOKEN）。返回仓库网页地址。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '仓库名' },
        description: { type: 'string', description: '仓库描述' },
        private: { type: 'boolean', description: '是否私有，默认 false（公开）' },
      },
      required: ['name'],
    },
  },
  {
    name: 'push_current_repo',
    description:
      '把当前项目目录初始化成 git 仓库并推送到 GitHub（目标仓库需已存在，可先用 create_repo 建）。',
    inputSchema: {
      type: 'object',
      properties: {
        repo_name: { type: 'string', description: '目标 GitHub 仓库名（不含用户名前缀）' },
        commit_message: { type: 'string', description: '提交信息，默认 Initial commit' },
      },
      required: ['repo_name'],
    },
  },
]

function needToken() {
  return TOKEN ? null : '错误：缺少 GITHUB_TOKEN，请在 .env 里配置（需 repo 权限）。'
}

async function githubApi(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': 'xycode',
      Accept: 'application/vnd.github+json',
      ...(options.headers || {}),
    },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
  return res.json()
}

// execFileSync + 参数数组，避免 shell 注入和引号问题
function git(...args) {
  return execFileSync('git', args, { cwd: TARGET_DIR, encoding: 'utf8' })
}

async function handleRequest(req) {
  const { method, params, id } = req

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'github', version: '1.0.0' },
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
      const tokenErr = needToken()
      if (tokenErr) {
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: tokenErr }], isError: true },
        }
      }

      if (params.name === 'create_repo') {
        const repo = await githubApi('/user/repos', {
          method: 'POST',
          body: JSON.stringify({
            name: args.name,
            description: args.description ?? '',
            private: args.private ?? false,
          }),
        })
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `仓库已创建：${repo.html_url}` }] },
        }
      }

      if (params.name === 'push_current_repo') {
        const me = await githubApi('/user')
        const username = me.login
        const repo = args.repo_name
        const msg = args.commit_message || 'Initial commit'

        git('init')
        git('add', '-A')
        try {
          git('commit', '-m', msg)
        } catch {
          // 没有可提交的改动，忽略
        }
        git('branch', '-M', 'main')
        // token 只塞进「一次性」push URL，不写进 .git/config，避免泄露
        const pushUrl = `https://x-access-token:${TOKEN}@github.com/${username}/${repo}.git`
        git('push', pushUrl, 'main')

        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `已推送：https://github.com/${username}/${repo}` }] },
        }
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

rl.on('line', async (line) => {
  try {
    const resp = await handleRequest(JSON.parse(line.trim()))
    if (resp) process.stdout.write(JSON.stringify(resp) + '\n')
  } catch {
    // 忽略无法解析的行
  }
})
