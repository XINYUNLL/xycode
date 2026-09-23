#!/bin/bash
# 测试环境一键配置脚本
# 用法: cd claude-code-from-scratch && bash test/setup.sh

set -e

echo "=== Mini Claude 测试环境配置 ==="

# 1. 创建 .mcp.json（MCP 服务器配置）
cat > .mcp.json << 'EOF'
{
  "mcpServers": {
    "test": {
      "command": "node",
      "args": ["test/mcp-server.cjs"]
    }
  }
}
EOF
echo "✓ 创建 .mcp.json (MCP 测试服务器)"

# 2. 复制 skill 到 .claude/skills/
mkdir -p .claude/skills
cp -r test/skills/* .claude/skills/
echo "✓ 安装测试 skills (greet, commit)"

# 3. 创建测试用的 CLAUDE.md（含 @include）
mkdir -p .claude/rules
echo "When the user greets you, respond in Chinese (中文)." > .claude/rules/chinese-greeting.md
cat > CLAUDE.md << 'EOF'
# Test Project Rules

@./.claude/rules/chinese-greeting.md

This is a test project for mini-claude feature validation.
EOF
echo "✓ 创建 CLAUDE.md (含 @include 指令) 和 rules"

# 4. 创建大文件用于测试持久化
python3 -c "
lines = [f'Line {i}: Test data for persistence validation - padding text here.' for i in range(1000)]
open('test/large-file.txt', 'w').write(chr(10).join(lines))
"
echo "✓ 创建 test/large-file.txt (约 75KB, 用于测试大结果持久化)"

# 5. 创建引号测试文件（Test 13: 引号规范化）
cat > test/quote-test.js << 'EOF'
const greeting = "Hello World";
const name = 'Alice';
EOF
echo "✓ 创建 test/quote-test.js (引号规范化测试)"

# 6. 创建自定义 agent 定义（Test 19: 自定义 Agent）
mkdir -p .claude/agents
cat > .claude/agents/reviewer.md << 'EOF'
---
name: reviewer
description: Code review specialist — analyzes code quality and suggests improvements
allowed-tools: read_file,list_files,grep_search
---
You are a code review specialist. Analyze the given code for:
1. Code quality issues
2. Potential bugs
3. Style inconsistencies
4. Missing error handling

Be concise. Only report actual issues, not stylistic preferences.
Return a structured review with severity levels: [critical], [warning], [info].
EOF
echo "✓ 创建 .claude/agents/reviewer.md (自定义 agent 测试)"

# 7. 检查 .env
if [ -f .env ]; then
    echo "✓ .env 已存在"
else
    echo "⚠ 未找到 .env，请创建:"
    echo '  ANTHROPIC_API_KEY=your-key-here'
    echo '  ANTHROPIC_BASE_URL=https://aihubmix.com  # 可选'
fi

echo ""
echo "=== 配置完成！==="
echo ""
echo "启动 TS 版:  npm run build && node dist/cli.js --yolo"
echo "启动 PY 版:  python -m mini_claude --yolo"
echo ""
echo "测试完成后运行: bash test/cleanup.sh"
