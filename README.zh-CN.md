# pi-esr

**工程状态运行时（Engineering State Runtime）** — 为 LLM 智能体设计的结构化状态机。

一个受约束的语义图状态机，专为工程、文档和决策智能任务设计。为 LLM 前缀缓存稳定性而生 — 每个字节都是确定性的。

**不是**记忆系统。**不是**聊天历史系统。**不是**检索式系统。

## 快速开始

Pi Agent（一条命令）：

```bash
npm install -g pi-esr
pi-esr setup
```

即可完成 — ESR 图工具、闭环工具、Pack 工具与可选记忆工具已就绪。

### MCP 客户端（Claude Code、Codex、Cursor）

```bash
npm install -g pi-esr
pi-esr plugin install --claude
pi-esr plugin install --codex
```

`pi-esr plugin install --claude` 会安装 Claude Code 原生插件，并自动注册 `pi-esr` MCP 服务。

`pi-esr plugin install --codex` 会安装 Codex 原生插件，并自动注册 `pi-esr` MCP 服务。

如果你只想注册 MCP 而不安装原生插件，仍然可以使用：

```bash
pi-esr setup --claude
pi-esr setup --codex
```

如果你更偏好手动方式，MCP 服务仍然通过 prompts discovery 暴露 `esr-system-prompt`。

### 从源码安装

```bash
git clone https://github.com/skepsun/pi-esr.git && cd pi-esr && npm install
npm test                    # 156 个测试
npm run typecheck           # 零类型错误
```

## 概述

pi-esr 将用户请求转化为结构化实体、类型化关系、显式状态转换和经过验证的操作。支持以下场景：

- **编码任务** — 实体 = 模块/类/函数，关系 = depends_on/implements
- **文档处理** — 实体 = 章节/文档/需求，关系 = supports/refines/contradicts
- **专家评估** — 实体 = 专家/评估/任务，关系 = evaluates/scores/validates
- **评分与决策支持** — 为实体附加数值化指标
- **跨会话连续性** — 图状态可在会话和项目之间持续保留

当前架构已经扩展为：

- `ESR Core`：唯一状态源，只管理实体、关系、任务、产物、约束与闭环
- `Memory Bridge`：探测宿主是否自带记忆机制，并选择合适 provider
- `Domain Pack`：把行业语义编译为 ESR 状态结构，不持有状态
- `Pack Registry`：内建轻量 pack market，统一列出可用行业包

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
| `esr_get_context` | 查询当前 ESR 图状态，可选附带记忆摘要 |
| `esr_get_closure_status` | 检查任务是否具备晋升到 stable 的闭环证据 |
| `esr_list_closure_gaps` | 列出当前任务闭环缺口 |
| `esr_list_tasks` | 视图化列出任务及闭环状态 |
| `esr_remove_entity` | 移除实体并级联删除其所有关系 |
| `esr_remove_relation` | 移除两个实体之间的特定关系 |
| `esr_attach_memory_ref` | 挂载外部记忆引用而不复制全文 |
| `esr_list_packs` | 列出当前可用的 Domain Pack |
| `esr_detect_pack` | 检测最匹配的 Domain Pack |
| `esr_expand_with_pack` | 用 Pack 展开任务、约束、产物与校验结果 |
### 记忆工具（可选 — 需要 `better-sqlite3`）

| 工具 | 说明 |
|------|------|
| `esr_mem_store` | 将观察记录锚定到 ESR 实体 |
| `esr_mem_recall` | 按 entity_id、文本搜索或两者结合召回记忆 |
| `esr_mem_timeline` | 查看某个实体的所有观察时间线 |
| `esr_mem_journal` | 查看实体状态转换日志或手动记录条目 |

## 记忆机制兼容

pi-esr 不假设宿主一定没有记忆系统，也不强制接管记忆。

- 如果宿主已有成熟记忆机制，`memory-bridge` 优先识别并让 ESR 以 `memory_ref` 方式协作
- 如果宿主没有可用记忆能力，ESR 可以退回 SQLite provider 或空 provider
- ESR 本身只保存会影响后续决策的结构化状态，不复制外部记忆全文

这使得 ESR 可以与不同框架自然配合，包括：

- 自带工程状态或记忆的 agent runtime
- 纯检索式 memory 插件
- 纯摘要式记忆插件
- 没有记忆能力的轻量宿主

自动检测的目标不是判断“谁更强”，而是避免两套状态系统互相打架。

## Domain Pack 与内建 Pack Market

pi-esr 现在支持轻量 `Domain Pack` 机制：

- `software`：软件研发与工程闭环
- `govdoc`：政企公文、申请书、预算与政策依据
- `planning-review`：规划审核、指标审查、整改闭环

设计边界保持克制：

- `ESR` 不理解行业
- `Pack` 不持久化状态
- `Adapter` 只做结构映射
- `Registry` 只做发现与选择

这意味着可以扩展行业能力，但不会把 ESR 本身膨胀成行业框架。

## 真实企业场景映射

当前已用真实材料反向校准过两类非软件场景：

- `planning-review`
  - 对应十五五规划审核、战略对齐、指标完整性、文本与数据一致性、整改跟踪
  - 已支持要求来源建模，可挂接国家标准或规范性文件作为审核依据
- `govdoc`
  - 对应公文写作、立项申请、预算章节、政策依据、风险章节完整性

这些语义都通过 `Pack -> ESR` 编译进入状态图，而不是写死在 Core。

## 命令

| 命令 | 说明 |
|---------|------|
| `/esr` | 显示当前 ESR 图 |
| `/esr-clear` | 清除所有 ESR 状态 |

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

## 持久化模型

ESR 会把图状态写入两个位置：

- **会话分支条目** — 宿主内的单会话审计轨迹
- **项目级文件** — `.pi-esr-memory/esr-state.json`，用于跨会话连续性
- **启动恢复** — 如果前两者都不存在，ESR 会扫描最近会话文件以恢复图状态

## 架构

```
packages/
└── core/                     @pi-esr/core — 框架无关引擎
    └── src/
        ├── types.ts              类型定义
        ├── validation.ts         本体校验器 + 状态转换矩阵
        ├── graph.ts              ESRGraph 类（核心状态机）
        ├── context.ts            ESR 上下文构建器 + 指纹
        ├── store.ts              MemoryStore — 基于 SQLite 的观察存储
        ├── recall.ts             实体锚定记忆上下文构建器
        ├── journal.ts            状态转换日志 + 摘要
        ├── session.ts            共享会话状态
        ├── host.ts               宿主接口
        └── index.ts              包入口点
extensions/
├── integration/
│   ├── tools.ts              11 个 ESR 工具注册
│   └── commands.ts           /esr /esr-clear /esr-mem
├── persistence/
│   ├── graph-persist.ts      统一持久化（会话 + 文件）
│   ├── snapshot.ts           图状态持久化适配器
│   └── reconstruct.ts        图状态重建
├── memory/
│   └── tools.ts              4 个 esr_mem_* 工具注册
├── prompt.ts                 提示词上下文构建器
└── index.ts                  扩展入口点

packages/core/tests/
├── graph.test.ts             49 个测试
├── memory.test.ts            24 个测试
├── session.test.ts           3 个测试
└── validate-efficiency.test.ts 11 个测试

tests/
├── tools.test.ts             6 个测试
├── persistence.test.ts       3 个测试
└── repository.test.ts        5 个测试
```

## 验证

### 正确性（156 个测试，11 个测试文件）

```bash
npm test                    # 156 个测试，<1s
npm run typecheck           # tsc --noEmit，零错误
```

| 层次 | 测试数 | 覆盖内容 |
|------|--------|----------|
| Graph core | 49 | 实体 CRUD、状态转换、环检测、序列化往返、指纹稳定性、不可变性、上下文构建器、artifact 自动代理 |
| Tool integration | 6 | 已注册图工具、持久化写入、错误处理、上下文输出 |
| Memory | 24 | 存储 CRUD、召回/搜索/时间线、日志、上下文构建器、格式化辅助、实体 ID 提取、会话标签过滤 |
| Session | 3 | 当前会话 ID 的获取/设置/重置 |
| Efficiency | 11 | Token 压缩基准、前缀缓存稳定性、上下文增长率、成本预估 |
| Persistence | 3 | 重建验证、畸形数据拒绝、会话分支状态加载 |
| Repository | 5 | 基于 SQLite 的版本化实体存储、冲突检测 |

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

## 黄金法则

1. 一切有意义的事物都是实体
2. 所有结构以关系为基础
3. 状态是唯一的真相
4. 操作是唯一的写入接口
5. 不能在本体中表示 → 不存储
6. 不影响未来决策 → 不存储
