#!/bin/bash
# 清理测试环境
# 用法: cd claude-code-from-scratch && bash test/cleanup.sh

set -e

echo "=== 清理测试环境 ==="

rm -f .mcp.json
rm -f CLAUDE.md
rm -rf .claude/skills/greet .claude/skills/commit
rm -rf .claude/rules
rm -rf .claude/agents
rm -f test/quote-test.js
rm -rf test/tmp
rm -rf ~/.mini-claude/projects/*/memory/*
rm -rf ~/.mini-claude/tool-results/
rm -f /tmp/mini-claude-agent-test.txt
# 恢复 package.json（如果被测试修改）
git checkout package.json 2>/dev/null || true

echo "✓ 清理完成"
