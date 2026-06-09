# ESR V2 重构计划

## 1. 目标

本计划用于将当前 `pi-esr` 从“图状态 + 内建记忆层”的混合架构，收敛为 **通用、可移植、与任意宿主记忆机制自然协同的工程状态内核**。

重构后的 v2 目标如下：

- `ESR` 只负责工程状态、关系、闭环与审计，不再承担“通用记忆系统”职责
- `memory` 改为 **bridge/provider 模式**，可对接 `pi-memory`、`claude-mem`、宿主内建 memory 或 file-memory
- 没有任何外部 memory 时，`ESR` 仍可完整工作
- 有外部 memory 时，`ESR` 只存引用，不重复吞入全文记忆
- 高层工具从“低层图操作集合”升级为“任务闭环与状态审计接口”

当前基线见：

- [packages/core/src/index.ts](/d1/chuxiong/code/pi-esr/packages/core/src/index.ts:1)
- [extensions/index.ts](/d1/chuxiong/code/pi-esr/extensions/index.ts:1)
- [packages/adapter-mcp/src/server.ts](/d1/chuxiong/code/pi-esr/packages/adapter-mcp/src/server.ts:1)

## 2. 当前问题

### 2.1 核心职责混杂

当前 `packages/core` 同时承担：

- 图状态机
- 仓储
- session state
- memory store
- journal/recall

这导致 `core` 对“工程状态”和“记忆实现”耦合过深，不利于通用兼容。

涉及文件：

- [packages/core/src/index.ts](/d1/chuxiong/code/pi-esr/packages/core/src/index.ts:1)
- [packages/core/src/store.ts](/d1/chuxiong/code/pi-esr/packages/core/src/store.ts:1)
- [packages/core/src/recall.ts](/d1/chuxiong/code/pi-esr/packages/core/src/recall.ts:1)
- [packages/core/src/journal.ts](/d1/chuxiong/code/pi-esr/packages/core/src/journal.ts:1)

### 2.2 适配层直接依赖 MemoryStore

Pi 与 MCP 适配层都直接实例化 `MemoryStore`，而不是依赖抽象接口。

涉及文件：

- [extensions/index.ts](/d1/chuxiong/code/pi-esr/extensions/index.ts:1)
- [extensions/memory/tools.ts](/d1/chuxiong/code/pi-esr/extensions/memory/tools.ts:1)
- [packages/adapter-mcp/src/server.ts](/d1/chuxiong/code/pi-esr/packages/adapter-mcp/src/server.ts:1)
- [packages/adapter-mcp/src/tools.ts](/d1/chuxiong/code/pi-esr/packages/adapter-mcp/src/tools.ts:1)

### 2.3 工具层仍以低层原语为主

当前主要工具仍是：

- `esr_create_entity`
- `esr_link_relation`
- `esr_update_artifact`
- `esr_evaluate`

缺少对“任务闭环完成”“闭环缺口审计”“外部 memory 引用挂接”的一等支持。

### 2.4 无法自动适配不同记忆系统

当前没有统一的 memory capability detection，也没有 provider 抽象。

结果是：

- 宿主有 memory 时，ESR 会与其重叠
- 宿主无 memory 时，又只能依赖当前 SQLite 实现

## 3. V2 目标架构

### 3.1 分层结构

```text
packages/
  core/                 工程状态内核
  memory-bridge/        记忆能力探测 + provider 抽象 + refs
  provider-*/           具体记忆系统桥接（后续逐步引入）
  adapter-mcp/          MCP 宿主适配
  adapter-opencode/     OpenCode 宿主适配

extensions/
  pi-adapter/           Pi 宿主适配（保留当前目录结构，逐步内聚）
```

### 3.2 核心职责拆分

#### `packages/core`

仅保留：

- `Entity / Relation / Artifact / Constraint / Evaluation`
- `ESRGraph`
- `context builder`
- `repository`
- `closure policy / closure service`
- `session state`

不再直接暴露：

- `MemoryStore`
- `recall`
- `journal`

#### `packages/memory-bridge`

负责：

- `ESRMemoryRef`
- `ESRMemoryProvider`
- `NullMemoryProvider`
- `detectMemoryCapabilities()`
- `selectMemoryProvider()`
- `ESRMemoryBridge`

#### `adapter-* / extensions`

负责：

- 宿主工具注册
- 生命周期接入
- provider 初始化
- 状态与 memory 的最终上下文组合

## 4. 目标接口

### 4.1 Memory Bridge

建议新增：

- `packages/memory-bridge/src/types.ts`
- `packages/memory-bridge/src/provider.ts`
- `packages/memory-bridge/src/null-provider.ts`
- `packages/memory-bridge/src/refs.ts`
- `packages/memory-bridge/src/detect.ts`
- `packages/memory-bridge/src/select.ts`

核心类型：

- `ESRMemoryRef`
- `ESRMemoryProvider`
- `MemoryCapabilityReport`

### 4.2 Closure Service

建议新增：

- `packages/core/src/closure.ts`

核心接口：

- `getClosureStatus(taskId)`
- `completeTask(input)`
- `attachMemoryRef(entityId, ref)`
- `listClosureGaps()`

### 4.3 V2 高层工具

建议新增：

- `esr_get_closure_status`
- `esr_complete_task`
- `esr_attach_memory_ref`
- `esr_list_tasks`
- `esr_list_closure_gaps`
- `esr_get_status`

保留低层工具作为底层原语，但不再作为默认推荐主流程。

## 5. 分阶段执行计划

### 阶段 0：冻结当前行为

目的：

- 确保后续重构不会破坏现有已恢复的行为

执行项：

1. 保持现有 `test:all` 绿灯状态
2. 以当前 `README`、`skills/esr/SKILL.md` 作为 v1 收敛基线
3. 明确 `runtime` 已不再属于公开能力

完成条件：

- `bun typecheck` 通过
- `npm run test:all` 通过

### 阶段 1：引入 memory-bridge 骨架

目的：

- 建立“通用兼容”的抽象层，但不立即改业务逻辑

新增文件：

- `packages/memory-bridge/src/types.ts`
- `packages/memory-bridge/src/provider.ts`
- `packages/memory-bridge/src/null-provider.ts`
- `packages/memory-bridge/src/detect.ts`
- `packages/memory-bridge/src/select.ts`
- `packages/memory-bridge/src/index.ts`

执行项：

1. 定义 `ESRMemoryRef`
2. 定义 `ESRMemoryProvider`
3. 实现 `NullMemoryProvider`
4. 实现 `detectMemoryCapabilities()`
5. 实现 `selectMemoryProvider()`

完成条件：

- 新包可独立 typecheck
- 还未替换现有 `MemoryStore` 路径

### 阶段 2：适配层改为依赖 provider 抽象

目的：

- 从 `MemoryStore | null` 迁移为 `ESRMemoryProvider`

涉及文件：

- [extensions/index.ts](/d1/chuxiong/code/pi-esr/extensions/index.ts:1)
- [extensions/memory/tools.ts](/d1/chuxiong/code/pi-esr/extensions/memory/tools.ts:1)
- [packages/adapter-mcp/src/server.ts](/d1/chuxiong/code/pi-esr/packages/adapter-mcp/src/server.ts:1)
- [packages/adapter-mcp/src/tools.ts](/d1/chuxiong/code/pi-esr/packages/adapter-mcp/src/tools.ts:1)

执行项：

1. 启动时先探测 capability
2. 若未发现外部 memory，则挂 `NullMemoryProvider`
3. 保留现有 SQLite memory 路径，但包装成 provider 形式
4. 将 memory 工具与 auto-journal 改为走 provider/bridge，而不是直接依赖 `MemoryStore`

完成条件：

- Pi 适配层不再直接实例化 `MemoryStore`
- MCP 适配层不再直接依赖 `MemoryStore` 类型

### 阶段 3：从 core 公开导出面移除 memory 实现

目的：

- 让 `core` 真正成为“工程状态内核”

涉及文件：

- [packages/core/src/index.ts](/d1/chuxiong/code/pi-esr/packages/core/src/index.ts:1)

执行项：

1. 从公开导出面移除：
   - `MemoryStore`
   - `Observation`
   - `JournalEntry`
   - `buildMemoryContext`
   - `buildActiveMemoryContext`
   - `formatObservation`
   - `formatJournalEntry`
   - `recordStateChange`
   - `recordStateChanges`
   - `buildJournalSummary`
2. 这些能力迁移到 `memory-bridge` 或 provider 层

完成条件：

- `@pi-esr/core` 只暴露状态机、仓储、context、closure、session

### 阶段 4：新增 closure service

目的：

- 提供高层闭环能力，摆脱“用户手动拼装 closure”

新增文件：

- `packages/core/src/closure.ts`

执行项：

1. 定义 `ESRClosureStatus`
2. 定义 `ESRClosurePolicy`
3. 实现：
   - `getClosureStatus`
   - `attachMemoryRef`
   - `listClosureGaps`
   - `completeTask`

完成条件：

- closure 逻辑集中在 core 内部，而不是散落在 tools/adapter 中

### 阶段 5：新增 v2 高层工具

目的：

- 提供更符合工程工作流的接口

涉及文件：

- [extensions/integration/tools.ts](/d1/chuxiong/code/pi-esr/extensions/integration/tools.ts:1)
- [packages/adapter-mcp/src/tools.ts](/d1/chuxiong/code/pi-esr/packages/adapter-mcp/src/tools.ts:1)

新增工具：

- `esr_get_closure_status`
- `esr_complete_task`
- `esr_attach_memory_ref`
- `esr_list_tasks`
- `esr_list_closure_gaps`
- `esr_get_status`

执行策略：

1. 保留 v1 低层图工具
2. 文档与 prompt 默认推荐 v2 高层工具
3. 底层工具保留给精细控制与迁移脚本

### 阶段 6：文档与提示词切换到 v2 叙述

涉及文件：

- `README.md`
- `README.zh-CN.md`
- `prompts/esr.md`
- `skills/esr/SKILL.md`
- `packages/adapter-mcp/src/server.ts`

执行项：

1. 把 ESR 定位改为：
   - 工程状态账本
   - closure / audit system
   - memory-aware，而非 memory-owning
2. 说明：
   - 无 memory 时如何运行
   - 有外部 memory 时如何 attach refs
   - 哪些信息应该进 ESR，哪些只进 memory

## 6. 文件级改造建议

### 6.1 立即保留

- `packages/core/src/graph.ts`
- `packages/core/src/context.ts`
- `packages/core/src/repository.ts`
- `packages/core/src/repository-sqlite.ts`
- `packages/core/src/session.ts`
- `extensions/persistence/*`

### 6.2 迁移出 core 导出面

- `packages/core/src/store.ts`
- `packages/core/src/recall.ts`
- `packages/core/src/journal.ts`

说明：

- 文件可暂时保留在仓库中，作为过渡实现
- 但从 v2 开始不再由 `@pi-esr/core` 对外导出

### 6.3 新增

- `packages/memory-bridge/src/*`
- `packages/core/src/closure.ts`
- `docs/esr-v2-refactor-plan.md`

### 6.4 未来可新增 provider 包

- `packages/provider-file-memory`
- `packages/provider-pi-memory`
- `packages/provider-claude-mem`

## 7. 测试策略

### 7.1 必须新增

- `packages/memory-bridge/tests/detect.test.ts`
- `packages/memory-bridge/tests/null-provider.test.ts`
- `packages/core/tests/closure.test.ts`
- `tests/complete-task.test.ts` 或合并进 `tests/tools.test.ts`

### 7.2 必须覆盖

1. 无 memory provider 时：
   - `completeTask` 可运行
   - `attachMemoryRef` 可拒绝非法引用
   - context 仍可正常输出

2. 有 memory provider 时：
   - summary 可写入外部 provider
   - `ESRMemoryRef` 可挂到任务
   - `closure_status` 会识别 memory ref

3. 探测逻辑：
   - 仅有 `AGENTS.md` 时不应过度自信判定
   - 有 `pi-memory` / `claude-mem` 依赖时应给出 provider hints

## 8. 验收标准

达到以下条件时，可认为 v2 重构完成：

1. `@pi-esr/core` 不再导出具体 memory 实现
2. 适配层仅依赖 `ESRMemoryProvider`
3. ESR 在没有外部 memory 时仍完整可用
4. ESR 在有外部 memory 时只保存 refs，不吞入全文
5. 提供 `esr_complete_task` 与 `esr_get_closure_status`
6. 文档、prompt、技能说明全部切到 v2 叙事
7. `bun typecheck` 通过
8. `npm run test:all` 通过

## 9. 建议的第一批实施范围

为了降低风险，建议第一批只做以下内容：

1. 新建 `packages/memory-bridge`
2. 引入 `NullMemoryProvider`
3. 在 Pi/MCP 适配层启动时做 capability detection
4. 新增 `packages/core/src/closure.ts`
5. 新增 `esr_get_closure_status`
6. 保持当前 `esr_mem_*` 不删，仅降级为可选 bridge 能力

这样可以先完成“架构转向”，再逐步推进 provider 和高层工具收敛。

## 10. 非目标

本轮 v2 重构明确不做：

- 重新引入 runtime / DAG 执行层
- 把 ESR 变成新的全文记忆数据库
- 强绑定某一个宿主（Claude、Pi、Codex）
- 强制所有用户必须安装 memory 插件

ESR v2 的原则是：

**状态是核心，记忆是外接能力，闭环是第一等对象。**
