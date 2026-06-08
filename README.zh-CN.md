# pi-esr

**工程状态运行时（Engineering State Runtime）** — 一次安装，适配所有智能体。

一个受约束的语义图状态机，专为工程、文档和决策智能任务设计。为 LLM 前缀缓存稳定性而生 — 每个字节都是确定性的。

**不是**记忆系统。**不是**聊天历史系统。**不是**检索式系统。

## 快速开始

```bash
npm install -g pi-esr
pi-esr setup
```

即可完成。Claude Code、Cursor、OpenCode 和 Pi Agent 现已配置 17 个 ESR 工具（13 个图/运行时 + 4 个记忆工具）。

### 在 MCP 客户端中使用（Claude Code、Cursor）

```bash
# 注册为 MCP 服务器
claude mcp add pi-esr -- npx @pi-esr/adapter-mcp

# 然后在 Claude Code 中加载 ESR 方法论提示词：
#   /prompts get pi-esr esr-system-prompt
# 这会教 LLM 何时以及如何使用 ESR 工具。
#
# 提示：将 prompt 输出添加到 CLAUDE.md 或项目指令中，
# 这样每个会话都会自动生效。
```

**从源码安装：**
```bash
git clone ... && cd pi-esr && npm install
npm test                    # 132 个测试
npm run typecheck           # 零类型错误
```

## 概述

pi-esr 将用户请求转化为结构化实体、类型化关系、显式状态转换和经过验证的操作。支持以下场景：

- **编码任务** — 实体 = 模块/类/函数，关系 = depends_on/implements
- **文档处理** — 实体 = 章节/文档/需求，关系 = supports/refines/contradicts
- **专家评估** — 实体 = 专家/评估/任务，关系 = evaluates/scores/validates
- **评分与决策支持** — 为实体附加数值化指标
- **运行时执行** — 基于 DAG 的任务编排，带缓存命中优化

## ESR 工具

| 工具 | 说明 |
|------|------|
| `esr_create_entity` | 创建实体（Actor / Artifact / Task / Concept / Constraint） |
| `esr_update_state` | 更新实体的状态、置信度或指标 |
| `esr_link_relation` | 在两个实体之间创建类型化关系 |
| `esr_evaluate` | 记录评估，附带置信度和指标 |
| `esr_score` | 为实体附加一个数值评分 |
| `esr_promote_task` | 将任务提升为 active 或 stable 状态 |
| `esr_update_artifact` | 创建或更新带版本章节的结构化文档 |
| `esr_apply_constraint` | 对实体施加约束 |
| `esr_get_context` | 查询当前 ESR 图状态 |
| `esr_remove_entity` | 移除实体并级联删除其所有关系 |
| `esr_remove_relation` | 移除两个实体之间的特定关系 |
| `esr_create_node` | 为 DAG 引擎创建运行时执行节点 |
| `esr_run` | 执行所有待处理的运行时节点直至空闲（零 Token DAG 调度） |

### 记忆工具（可选 — 需要 `better-sqlite3`）

| 工具 | 说明 |
|------|------|
| `esr_mem_store` | 将观察记录锚定到 ESR 实体 |
| `esr_mem_recall` | 按 entity_id、文本搜索或两者结合召回记忆 |
| `esr_mem_timeline` | 查看某个实体的所有观察时间线 |
| `esr_mem_journal` | 查看实体状态转换日志或手动记录条目 |

## 命令

| 命令 | 说明 |
|---------|------|
| `/esr` | 显示 ESR 图 + 运行时节点 |
| `/esr-clear` | 清除所有 ESR 状态 |
| `/esr-step` | 执行一次运行时 tick |
| `/esr-run [maxSteps]` | 运行 runtime 直至空闲 |

## 守护机制

- **状态机强制** — `stable → draft` 被拒绝；仅允许合法转换
- **环检测** — 通过 DFS 检查结构性边（`depends_on`、`part_of`、`implements`、`triggers`）是否存在环
- **置信度钳位** — 所有置信度值在 `[0, 1]` 区间内验证
- **重复防护** — 拒绝相同关系和重复评估
- **不可变性** — `getEntity()` 返回防御性拷贝，内部状态不可被篡改
- **加密 ID** — 约束实体使用 `crypto.randomUUID()`
- **时间戳** — 每个实体携带 `updated_at`，从上下文中排除以保护缓存
- **上下文指纹** — `buildGraphFingerprint`（DJB2 哈希）支持缓存命中诊断
- **查询辅助** — `getRelationsFor(entityId)` 和 `getRelationsByType(type)`

## 缓存稳定性

ESR 专为 DeepSeek 风格的前缀缓存设计。三个不变式确保字节级稳定的上下文：

1. **系统提示词在运行时永不变化** — `prompts/esr.md` 是静态文件
2. **上下文注入包装器始终保持一致** — 不分空/非空分支
3. **所有上下文输出确定性排序** — 实体按 ID 排序，关系按 (from, type, to) 排序

系统提示词还包含 **缓存稳定性规则**，禁止 LLM 重新排列、改写或注释 ESR 上下文块。

## 运行时引擎

ESR 包含一个基于 DAG 的执行引擎，用于编排多步骤工具工作流：

- **执行节点** — `pending → ready → running → succeeded/failed/blocked/cached`
- **依赖规划** — `computeRunnableNodes` 评估 DAG 就绪状态
- **SHA256 缓存键** — 确定性键值包含 inputs + 依赖指纹 + artifact 版本
- **失效级联** — 图变更会将依赖的运行时节点标记为失效
- **工具驱动抽象** — 运行时工具调度独立于 pi 的工具定义

## 架构

```
packages/
└── core/                     @pi-esr/core — 框架无关引擎
    └── src/
        ├── types.ts              类型定义
        ├── validation.ts         本体校验器 + 状态转换矩阵
        ├── graph.ts              ESRGraph 类（核心状态机）
        ├── context.ts            ESR 上下文构建器 + 指纹
        ├── runtime.ts            ESRRuntime — tick 循环 + runUntilIdle
        ├── state.ts              ESRRuntimeStateStore — 节点存储 + 事件
        ├── planner.ts            DAG 依赖规划器
        ├── executor.ts           带缓存层的节点执行
        ├── scheduler.ts          简单优先级调度器
        ├── cache.ts              InMemoryCacheStore + SHA256 缓存键
        ├── runtime-types.ts      ExecutionNode、RuntimeEvent 等
        ├── driver.ts             ToolDriverRegistry
        ├── store.ts              MemoryStore — 基于 SQLite 的观察存储
        ├── recall.ts             实体锚定记忆上下文构建器
        ├── journal.ts            状态转换日志 + 摘要
        ├── session.ts            共享会话状态
        ├── host.ts               宿主接口
        └── index.ts              包入口点
extensions/
├── integration/
│   ├── tools.ts              12 个 ESR 工具注册 + 运行时工具驱动
│   └── commands.ts           /esr /esr-clear /esr-step /esr-run /esr-mem
├── persistence/
│   ├── graph-persist.ts      统一持久化（会话 + 文件）
│   ├── snapshot.ts           图状态持久化适配器
│   ├── reconstruct.ts        图状态重建
│   ├── runtime-state.ts      运行时状态持久化
│   └── runtime-cache.ts      运行时缓存持久化
├── memory/
│   └── tools.ts              4 个 esr_mem_* 工具注册
├── prompt.ts                 提示词上下文构建器
└── index.ts                  扩展入口点

packages/core/tests/
├── graph.test.ts             49 个测试
├── cache.test.ts             4 个测试
├── planner.test.ts           4 个测试
├── runtime.test.ts           6 个测试
├── memory.test.ts            24 个测试
├── session.test.ts           3 个测试
└── validate-efficiency.test.ts 11 个测试

tests/
├── tools.test.ts             21 个测试
├── persistence.test.ts       4 个测试
└── repository.test.ts        3 个测试
```

## 验证

### 正确性（132 个测试，10 个测试文件）

```bash
npm test                    # 132 个测试，<1s
npm run typecheck           # tsc --noEmit，零错误
```

| 层次 | 测试数 | 覆盖内容 |
|------|--------|----------|
| Graph core | 49 | 实体 CRUD、状态转换、环检测、序列化往返、指纹稳定性、不可变性、上下文构建器、artifact 自动代理 |
| Tool drivers | 21 | 全部 11 个驱动操作 + 调度器 + 运行时上下文 |
| Runtime | 6 | Tick 执行、缓存命中、失效级联、持久化状态往返 |
| Cache | 4 | SHA256 键确定性、输入变更检测、artifact 版本影响、持久化往返 |
| Planner | 4 | 依赖满足/无依赖/等待中、失败阻塞分类 |
| Memory | 24 | 存储 CRUD、召回/搜索/时间线、日志、上下文构建器、格式化辅助、实体 ID 提取、会话标签过滤 |
| Session | 3 | 当前会话 ID 的获取/设置/重置 |
| Efficiency | 11 | Token 压缩基准、前缀缓存稳定性、上下文增长率、成本预估、DAG 并行 |
| Persistence | 4 | 重建验证、畸形数据拒绝、会话分支状态加载 |
| Repository | 3 | 基于 SQLite 的版本化实体存储、冲突检测 |

### 效率基准

```bash
npx vitest run tests/validate-efficiency.test.ts --reporter=verbose
```

#### Token 压缩 vs 聊天历史

| 实体数 | ESR 上下文 | 聊天等价 | 比率 | 节省 |
|--------|-----------|----------|------|------|
| 5 | 138t | 210t | 1.5x | 34.3% |
| 10 | 260t | 435t | 1.7x | 40.2% |
| 20 | 515t | 897t | 1.7x | 42.6% |
| 50 | 1280t | 2285t | 1.8x | 44.0% |
| 100 | 2555t | 4597t | 1.8x | 44.4% |

在大规模场景下，ESR 上下文比等效聊天历史紧凑约 1.8 倍。

#### 前缀缓存稳定性

- 相同状态 → 相同指纹 → **100% 缓存命中**
- 添加/移除实体 → 指纹变化（正确的缓存未命中）
- 上下文输出是 **逐字节确定性**的 — 兼容 DeepSeek/Claude 前缀缓存
- 每实体开销：~11 tokens（线性 O(n)，无平方爆炸）
- 每关系开销：~18 tokens（实体+关系，线性 O(n)）

#### DAG 并行

| 场景 | 串行（聊天） | ESR 运行时 | 缩减 |
|------|------------|-----------|------|
| 3 个独立节点 | 3 轮 LLM | 1 次 `esr_run`（零 Token） | **67%** |
| 5 节点链，1 个变更 | 5 次重复执行 | 3 次重复执行（2 个缓存命中） | **40%** |

#### 成本预估（DeepSeek 定价）

对于一个包含 100 个实体、50 轮对话的会话：
- 聊天历史成本（无缓存）：约 $0.032
- ESR 含前缀缓存命中：约 $0.0015
- **预计每次会话节省：$0.03+**（跨多次会话持续累加）
```

## 状态转换矩阵

| 从 ↓ / 到 → | draft | active | stable | blocked | deprecated |
|-------------|-------|--------|--------|---------|------------|
| **draft**     | —     | ✓      | ✓      | ✓       | ✓          |
| **active**    | ✗     | —      | ✓      | ✓       | ✓          |
| **stable**    | ✗     | ✓      | —      | ✓       | ✓          |
| **blocked**   | ✓     | ✓      | ✗      | —       | ✓          |
| **deprecated**| ✓     | ✗      | ✗      | ✗       | —          |

## 核心本体

### 实体角色
`Actor` | `Artifact` | `Task` | `Concept` | `Constraint`

### 关系类型
**结构型：** `depends_on` | `part_of` | `implements`
**语义型：** `supports` | `contradicts` | `refines`
**评估型：** `evaluates` | `scores` | `validates`
**操作型：** `triggers` | `updates` | `blocks` | `produces`

### 执行状态
`pending` | `ready` | `running` | `succeeded` | `failed` | `blocked` | `cached`

## 黄金法则

1. 一切有意义的事物都是实体
2. 所有结构以关系为基础
3. 状态是唯一的真相
4. 操作是唯一的写入接口
5. 不能在本体中表示 → 不存储
6. 不影响未来决策 → 不存储
