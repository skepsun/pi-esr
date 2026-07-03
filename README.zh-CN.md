# pi-esr

**工程状态运行时（Engineering State Runtime）** — 为 LLM 智能体设计的结构化状态机。

一个受约束的语义图状态机，专为工程、文档和决策智能任务设计。为 LLM 前缀缓存稳定性而生 — 每个字节都是确定性的。

**不是**记忆系统。**不是**聊天历史系统。**不是**检索式系统。

## 快速开始

### Pi Agent

```bash
npm install -g pi-esr
pi-esr setup
```

ESR 图工具、闭环工具、Pack 工具与可选记忆工具已就绪。

### Claude Code

```bash
npm install -g pi-esr
pi-esr plugin install --claude
```

安装 Claude Code 原生插件，并自动注册 `pi-esr` MCP 服务。

### Codex (OpenAI)

```bash
npm install -g pi-esr
pi-esr plugin install --codex
```

安装 Codex 原生插件，并自动注册 `pi-esr` MCP 服务。

### 仅 MCP（不安装原生插件）

```bash
pi-esr setup --claude
pi-esr setup --codex
```

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

当前架构分为四个刻意分离的层次：

- `ESR Core`：唯一状态源，管理实体、关系、任务、产物、约束与闭环
- `Memory Bridge`：探测宿主记忆能力并选择兼容 provider（pi-loom、SQLite、null）
- `Domain Pack`：把行业语义编译为 ESR 状态结构，不持有状态
- `Pack Registry`：内建轻量 pack market，统一列出可用行业包

## ESR 工具

### 核心（16 个工具）

| 工具 | 说明 |
|------|------|
| `esr_create_entity` | 创建实体（Task / Constraint / Concept / Actor / Artifact） |
| `esr_update_state` | 更新实体的状态、置信度或指标 |
| `esr_link_relation` | 在两个实体之间创建类型化关系 |
| `esr_evaluate` | 记录评估，附带置信度和指标 |
| `esr_update_artifact` | 创建或更新带版本章节的结构化文档 |
| `esr_get_context` | 查询当前 ESR 图状态 |
| `esr_get_closure_status` | 检查任务是否具备晋升到 stable 的闭环证据 |
| `esr_list_closure_gaps` | 列出当前任务闭环缺口 |
| `esr_list_tasks` | 视图化列出任务及闭环状态 |
| `esr_remove_entity` | 移除实体并级联删除其所有关系 |
| `esr_remove_relation` | 移除两个实体之间的特定关系 |
| `esr_attach_memory_ref` | 挂载外部记忆引用而不复制全文 |
| `esr_list_packs` | 列出当前可用的 Domain Pack |
| `esr_detect_pack` | 检测最匹配的 Domain Pack |
| `esr_expand_with_pack` | 用 Pack 展开任务、约束、产物与校验结果 |
| `esr_complete_task` | **主闭环路径** — 产物 + 评估 + 闭环 → stable |

### 记忆工具（内建，需 `better-sqlite3`）

| 工具 | 说明 |
|------|------|
| `esr_mem_store` | 将观察记录锚定到 ESR 实体 |
| `esr_mem_recall` | 按 entity_id、文本搜索或两者结合召回记忆 |
| `esr_mem_timeline` | 查看某个实体的所有观察时间线 |
| `esr_mem_journal` | 查看实体状态转换日志或手动记录条目 |

## 记忆机制兼容

pi-esr 不假设宿主一定没有记忆系统，也不强制接管记忆。

- 如果宿主已有成熟记忆机制（如 pi-loom），`memory-bridge` 优先识别并让 ESR 以 `memory_ref` 方式协作
- 如果宿主没有可用记忆能力，ESR 可以退回 SQLite provider 或空 provider
- ESR 本身只保存会影响后续决策的结构化状态，不复制外部记忆全文

这使得 ESR 可以与不同框架自然配合，包括：

- 自带工程状态或记忆的 agent runtime
- 纯检索式 memory 插件
- 纯摘要式记忆插件
- 没有记忆能力的轻量宿主

## Domain Pack 与内建 Pack Market

pi-esr 支持轻量 Domain Pack 机制：

- `software@0.1.0`：软件研发、重构、typecheck 与测试闭环
- `agent-tool@0.1.0`：工具契约设计、schema、错误分类、超时策略、幂等检查
- `govdoc@0.3.0`：政企公文、申请书、预算与政策依据
- `planning-review@0.3.0`：规划审核、指标审查、整改闭环
- `refactor@0.1.0`：抽取、迁移、验证、文档化工作流

设计边界保持克制：

- `ESR` 不理解行业
- `Pack` 不持久化状态
- `Adapter` 只做结构映射
- `Registry` 只做发现与选择

## 真实企业场景映射

已用真实材料校准过两类非软件场景：

- `planning-review`：十五五规划审核、战略对齐、指标完整性、文本与数据一致性、整改跟踪。支持要求来源建模，可挂接国家标准作为审核依据
- `govdoc`：公文写作、立项申请、预算章节、政策依据、风险章节完整性

所有语义都通过 `Pack -> ESR` 编译进入状态图，而非写死在 Core。

## 命令

| 命令 | 说明 |
|------|------|
| `/esr` | 显示当前 ESR 图 |
| `/esr-clear` | 清除所有 ESR 状态 |

## 核心本体

### LLM 暴露的角色（子集）

| 角色 | 用途 |
|------|------|
| `Task` | 工作单元：draft → active → stable（或 blocked / deprecated） |
| `Constraint` | 校验 Task 的质量门或规则 |
| `Concept` | 抽象概念、模式或领域术语 |

完整类型系统还包含 `Actor` 和 `Artifact`（详见 `packages/core/src/types.ts`）。

### LLM 暴露的关系类型（子集）

| 类型 | 含义 |
|------|------|
| `depends_on` | 任务 A 必须在任务 B 之前完成 |
| `produces` | 任务产生一个产物 |
| `validates` | 约束校验任务 |
| `blocks` | 实体 A 阻塞实体 B |
| `refines` | 实体 A 是实体 B 的子任务/细节 |
| `evaluates` | 评估者判断实体 |

完整类型系统还包含 `part_of`、`implements`、`supports`、`contradicts`、`scores`、`triggers`、`updates`。

## 守护机制

- **状态机强制** — 仅允许合法转换；`stable → draft` 被拒绝
- **环检测** — DFS 检测结构性边（depends_on、part_of、implements、triggers）
- **置信度钳位** — 所有置信度值在 [0, 1] 区间内验证
- **重复防护** — 拒绝相同关系和重复评估
- **不可变性** — `getEntity()` 返回防御性拷贝
- **加密 ID** — 约束实体使用 `crypto.randomUUID()`
- **时间戳** — 每个实体携带 `updated_at`，从上下文中排除以保护缓存
- **上下文指纹** — `buildGraphFingerprint`（DJB2 哈希）支持缓存命中诊断
- **查询辅助** — `getRelationsFor(entityId)`、`getRelationsByType(type)`

## 缓存稳定性

ESR 专为 DeepSeek 风格的前缀缓存设计。三个不变式：

1. **系统提示词在运行时永不变化** — `prompts/esr.md` 是静态文件
2. **上下文注入包装器始终保持一致** — 不分空/非空分支
3. **所有上下文输出确定性排序** — 实体按 ID 排序，关系按 (from, type, to) 排序

## 持久化模型

- **会话分支条目** — 宿主内的单会话审计轨迹
- **项目级文件** — `.pi-esr-memory/esr-state.json`，用于跨会话连续性
- **启动恢复** — 如果前两者都不存在，ESR 会扫描最近会话文件以恢复图状态

## 架构

```
packages/
├── core/                          @pi-esr/core — 框架无关引擎
│   └── src/
│       ├── types.ts               实体/关系/状态类型定义
│       ├── validation.ts          本体校验器 + 状态转换矩阵
│       ├── graph.ts               ESRGraph 类（核心状态机）
│       ├── context.ts             ESR 上下文构建器 + 指纹
│       ├── closure.ts             闭环协议 + 评估引擎
│       ├── store.ts               MemoryStore — SQLite 观察存储
│       ├── recall.ts              实体锚定记忆上下文构建器
│       ├── journal.ts             状态转换日志 + 摘要
│       ├── session.ts             共享会话状态
│       ├── host.ts                宿主接口
│       ├── driver.ts              图执行驱动器
│       ├── planner.ts             任务规划引擎
│       ├── scheduler.ts           任务调度引擎
│       ├── runtime.ts             运行时类型与生命周期
│       ├── runtime-types.ts       运行时类型守卫
│       ├── repository.ts          仓库接口
│       ├── repository-sqlite.ts   SQLite 版本化实体存储
│       ├── state.ts               状态机核心
│       ├── cache.ts               缓存工具
│       ├── executor.ts            任务执行器
│       └── index.ts               包入口点
├── adapter-mcp/                   @pi-esr/adapter-mcp — MCP 服务适配器
├── adapter-opencode/              @pi-esr/adapter-opencode — OpenCode 适配器
├── cli/                           pi-esr CLI — setup、plugin install、MCP 注册
├── domain-pack/                   @pi-esr/domain-pack — Pack 协议 + 适配器类型
├── domain-pack-agent-tool/        智能体工具开发领域包
├── domain-pack-govdoc/            政企公文领域包
├── domain-pack-planning-review/   规划审核领域包
├── domain-pack-refactor/          重构领域包
├── domain-pack-software/          软件工程领域包
└── memory-bridge/                 @pi-esr/memory-bridge — 宿主能力检测 + provider 选择

extensions/
├── integration/
│   ├── tools.ts              16 个 ESR 工具注册
│   └── commands.ts           /esr /esr-clear
├── persistence/
│   ├── graph-persist.ts      统一持久化（会话 + 文件）
│   ├── snapshot.ts            图状态持久化适配器
│   └── reconstruct.ts         图状态重建
├── memory/
│   └── tools.ts              4 个 esr_mem_* 工具注册
├── overlay/
│   ├── widget.ts              TUI 覆盖层组件
│   ├── format.ts              输出格式化
│   └── selectors.ts           实体选择器
├── memory-bridge.ts           记忆桥扩展
├── prompt.ts                  提示词上下文构建器
├── core.ts                    核心扩展
└── index.ts                   扩展入口点
```

## 验证

### 正确性（156 个测试，11 个测试文件）

```bash
npm test                    # 156 个测试，<1s
npm run typecheck           # tsc --noEmit，零错误
```

| 层次 | 测试数 | 覆盖内容 |
|------|--------|----------|
| Graph core | 54 | 实体 CRUD、状态转换、环检测、序列化往返、指纹稳定性、不可变性、上下文构建器、artifact 自动代理、邻域查询 |
| Closure | 10 | 评估引擎、约束校验、闭环晋升、策略门控、记忆引用要求 |
| Tool integration | 25 | 全部 16 个 ESR 工具、Pack 检测/展开、闭环工作流、领域包场景（software、govdoc、planning-review） |
| Memory | 24 | 存储 CRUD、召回/搜索/时间线、日志、上下文构建器、格式化辅助、会话标签过滤 |
| Session | 3 | 当前会话 ID 的获取/设置/重置 |
| Efficiency | 15 | Token 压缩基准、前缀缓存稳定性、上下文增长率、成本预估、DAG 并行、真实场景 |
| Persistence | 3 | 重建校验、畸形数据拒绝、会话分支状态加载、镜像锁定 |
| Repository | 5 | SQLite 版本化实体存储、冲突检测、并发客户端安全 |
| MCP adapter | 11 | MCP 工具注册、参数校验、hook 上下文注入、Pack 工具、快照镜像 |
| E2E multi-session | 5 | 3 会话重构场景、状态连续性、跨会话闭环、artifact 自动代理 |

### 效率基准

#### Token 压缩 vs 聊天历史

| 实体数 | ESR 上下文 | 聊天等价 | 比率 | 节省 |
|--------|-----------|----------|------|------|
| 5 | 124t | 210t | 1.7x | 41.0% |
| 10 | 240t | 435t | 1.8x | 44.8% |
| 20 | 479t | 897t | 1.9x | 46.6% |
| 50 | 1,199t | 2,285t | 1.9x | 47.5% |
| 100 | 2,400t | 4,597t | 1.9x | 47.8% |

在大规模场景下，ESR 上下文比等效聊天历史紧凑约 1.9 倍。

#### 前缀缓存稳定性

- 相同状态 → 相同指纹 → **100% 缓存命中**
- 添加/移除实体 → 指纹变化（正确的缓存未命中）
- 上下文输出是 **逐字节确定性**的 — 兼容 DeepSeek/Claude 前缀缓存
- 每实体开销：~9.5 tokens（线性 O(n)，无平方爆炸）
- 每关系开销：~16.7 tokens（实体+关系，线性 O(n)）

#### 成本预估（DeepSeek 定价）

100 个实体、50 轮对话的会话：
- 聊天历史 tokens：4,597
- ESR 上下文 tokens：2,102
- 每轮节省 tokens：2,495
- 聊天历史成本（无缓存）：约 $0.032
- ESR 含前缀缓存命中：约 $0.0015
- **预计每次会话节省：$0.03+**（跨多次会话持续累加）

#### DAG 并行

- 3 个独立节点：ESR 1 轮执行 vs 聊天 3 轮顺序执行 → **轮次减少 67%**
- 缓存失效：仅重新执行变更节点及其下游 → **节省 40% 工作量** vs 全量重跑

#### 真实场景

5 模块重构（auth、db、api、ui、cli），含 4 个 depends_on 关系和 5 次评估：
- ESR 上下文：287 tokens vs ~1,000 聊天等价 → **3.5x 压缩**

## 状态转换矩阵

| 从 ↓ / 到 → | draft | active | stable | blocked | deprecated |
|-------------|-------|--------|--------|---------|------------|
| **draft**     | —     | ✓      | ✓      | ✓       | ✓          |
| **active**    | ✗     | —      | ✓      | ✓       | ✓          |
| **stable**    | ✗     | ✓      | —      | ✓       | ✓          |
| **blocked**   | ✓     | ✓      | ✗      | —       | ✓          |
| **deprecated**| ✓     | ✗      | ✗      | ✗       | —          |

## 黄金法则

1. 一切有意义的工作 → 实体
2. 一切约束 → 实体 + validates 关系
3. 一切已完成的任务 → `esr_complete_task`（产物 + 评估 → stable）
4. 状态是唯一真相 — 不确定时，调用 `esr_get_context`
5. 不能在本体中表示 → 不存储
6. 不影响未来决策 → 不存储
