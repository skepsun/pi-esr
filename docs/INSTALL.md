# ESR + Loom 从零安装指南

## 前置依赖

```bash
node >= 18
npm >= 9
# 可选: better-sqlite3 编译需要 gcc/g++ 和 python3
```

确保 Codex CLI 和 Claude Code 已安装：
```bash
npm install -g @openai/codex        # Codex CLI
npm install -g @anthropic-ai/claude-code  # Claude Code
```

---

## 方案一：从源码安装（推荐，适配器完整）

### 1. 克隆并构建 ESR

```bash
git clone https://github.com/skepsun/pi-esr.git
cd pi-esr
npm install
npm run build          # tsc + workspace 构建
npm test               # 156 tests passed ✓
npm run typecheck      # 0 errors ✓
```

### 2. 安装 ESR 到 Codex 和 Claude Code

```bash
# 全局链接（使 pi-esr CLI 可用）
npm link

# 一键安装：插件 + MCP 注册
pi-esr plugin install           # 安装到 Claude Code + Codex + Pi

# 或逐个安装：
pi-esr plugin install --claude  # Claude Code
pi-esr plugin install --codex   # Codex
```

这一步实际做了：
- **Claude Code**: `claude plugin marketplace add <源码路径>` → `claude plugin install pi-esr` → `claude mcp add pi-esr -- node <本地 dist>`
- **Codex**: `codex plugin marketplace add <源码路径>` → `codex plugin add pi-esr@pi-esr` → `codex mcp add pi-esr -- node <本地 dist>`

### 3. 克隆并构建 Loom

```bash
cd /d1/chuxiong/code
git clone https://github.com/skepsun/pi-loom.git
cd pi-loom
npm install
npm run build
```

### 4. 安装 Loom 的 MCP 服务器到 Codex 和 Claude Code

Loom 没有 `plugin install` CLI，直接注册 MCP：

```bash
# Claude Code
claude mcp add pi-loom -- node /d1/chuxiong/code/pi-loom/dist/mcp-server.js

# Codex  
codex mcp add pi-loom -- node /d1/chuxiong/code/pi-loom/dist/mcp-server.js
```

### 5. 验证

```bash
# ESR 状态
pi-esr plugin status

# Claude Code 内检查
claude mcp list | grep -E "pi-esr|pi-loom"

# Codex 内检查
codex mcp list | grep -E "pi-esr|pi-loom"
```

---

## 方案二：从 npm 发行版安装（ESR 插件 + MCP 用本地 dist）

> ⚠️ npm 发布的 `pi-esr` 包不包含 `adapter-mcp` MCP 服务器，MCP 注册需指向本地源码构建的 dist。

### 1. 安装 npm 包

```bash
npm install -g pi-esr
```

### 2. 构建 adapter-mcp（仍需源码）

```bash
git clone https://github.com/skepsun/pi-esr.git
cd pi-esr
npm install
npm run build --workspace=packages/adapter-mcp
```

### 3. 注册插件

```bash
# Claude Code 原生插件
claude plugin marketplace add /d1/chuxiong/code/pi-esr
claude plugin install pi-esr

# Codex 原生插件
codex plugin marketplace add /d1/chuxiong/code/pi-esr
codex plugin add pi-esr@pi-esr
```

### 4. 注册 MCP 服务器

```bash
# ESR MCP — 指向本地 dist
claude mcp add pi-esr -- node /d1/chuxiong/code/pi-esr/packages/adapter-mcp/dist/server.js
codex mcp add pi-esr -- node /d1/chuxiong/code/pi-esr/packages/adapter-mcp/dist/server.js

# Loom MCP
claude mcp add pi-loom -- node /d1/chuxiong/code/pi-loom/dist/mcp-server.js
codex mcp add pi-loom -- node /d1/chuxiong/code/pi-loom/dist/mcp-server.js
```

---

## 方案三：纯 MCP 模式（不装原生插件）

适合只需要工具、不需要 Claude Code / Codex 原生插件的场景：

```bash
# ESR
claude mcp add pi-esr -- node /path/to/pi-esr/packages/adapter-mcp/dist/server.js
codex mcp add pi-esr -- node /path/to/pi-esr/packages/adapter-mcp/dist/server.js

# Loom
claude mcp add pi-loom -- node /path/to/pi-loom/dist/mcp-server.js
codex mcp add pi-loom -- node /path/to/pi-loom/dist/mcp-server.js
```

---

## 卸载

```bash
# 一键卸载（从所有 agent）
pi-esr plugin remove
pi-esr remove

# 或逐个卸载
pi-esr plugin remove --claude
pi-esr plugin remove --codex
pi-esr remove --claude
pi-esr remove --codex

# Loom MCP 卸载
claude mcp remove pi-loom
codex mcp remove pi-loom

# 清理 npm
npm unlink -g pi-esr pi-loom
```

---

## 安装后的目录结构

```
~/.claude/
  plugins/
    cache/pi-esr/pi-esr/0.3.0/   # Claude 插件缓存
    installed_plugins.json        # 含 pi-esr@pi-esr entry
    known_marketplaces.json       # 含 pi-esr marketplace
  .claude.json                    # projects 中 mcpServers.pi-esr / pi-loom

~/.codex/
  config.toml                     # [plugins."pi-esr@pi-esr"], [mcp_servers.pi-esr/lom]
  plugins/cache/pi-esr/           # Codex 插件缓存

项目根目录/
  .pi-esr-memory/                 # ESR 状态 (esr-state.json + memory.db)
  .pi-loom/                       # Loom 记忆数据
```

---

## 注意事项

1. **必须先 build** — 无论是 ESR 还是 Loom，都需要 `npm run build` 生成 `dist/` 目录
2. **adapter-mcp 路径** — 在源码 tree 中位于 `packages/adapter-mcp/dist/server.js`
3. **better-sqlite3** — 如果编译失败，确保系统有 `build-essential` / `python3`
4. **重启 agent** — 安装后必须重启 Codex/Claude 才能加载新插件和 MCP 服务器
