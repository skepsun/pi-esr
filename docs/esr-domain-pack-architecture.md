# ESR Domain Pack 架构

## 1. 目标

本文定义 `ESR Core + Domain Pack + Pack Adapter` 的最小可实现架构，用于在不污染 `ESR` 状态内核的前提下，扩展行业模板、规则、校验器与产物定义。

目标约束：

- `ESR Core` 不理解行业语义
- `Domain Pack` 不持久化状态
- `Pack Adapter` 只负责语义映射，不成为第二工作流引擎
- 所有最终状态仍只落在 `ESR Core`

## 2. 分层职责

### 2.1 ESR Core

`ESR Core` 只负责：

- `Entity / Relation / Artifact / Constraint`
- `Task` 生命周期
- `closure service`
- `task views`
- `memory refs`
- persistence

`ESR` 不知道：

- 什么是“立项书”
- 什么是“预算合规”
- 什么是“论文贡献”

### 2.2 Domain Pack

`Domain Pack` 负责行业语义：

- templates
- constraints
- validators
- artifact schemas

但它必须是无状态的：

- 不保存 graph
- 不管理 task lifecycle
- 不维护 memory
- 不决定 persistence

### 2.3 Pack Adapter

`Pack Adapter` 负责把 `Domain Pack` 输出映射成 `ESR` 操作：

- template expansion -> entities / relations
- validator result -> evaluations / constraints / closure gaps
- artifact schema -> ESR artifacts
- external memory summary -> `memory_refs`

这一层是隔离边界，不应演化为另一套 runtime。

## 3. 结构建议

```text
packages/
  core/                  ESR 状态内核
  memory-bridge/         记忆探测与 provider 抽象
  domain-pack/           Pack 协议与 adapter 协议
  domain-pack-software/  软件工程示例 pack
  domain-pack-govdoc/    政企公文示例 pack（后续）
  adapter-mcp/           MCP 适配
  adapter-opencode/      OpenCode 适配
```

当前仓库中的最小可运行对应关系已经成立：

- `packages/memory-bridge`
- `packages/domain-pack`
- `packages/domain-pack-software`
- `packages/domain-pack-govdoc`
- `packages/domain-pack-planning-review`
- `packages/adapter-mcp`

## 4. Pack 协议

建议 Pack 只暴露 3 类能力：

1. `detect`
2. `expand`
3. `validate`

最小接口：

```ts
interface ESRDomainPack {
  name: string;
  version: string;
  description?: string;
  detect(input: ESRPackDetectInput): Promise<number>;
  expand(input: ESRPackExpandInput): Promise<ESRPackExpansion>;
  validate(input: ESRPackValidateInput): Promise<ESRPackValidationResult>;
}
```

### 4.1 detect

职责：

- 判断当前请求与该 Pack 的匹配度
- 返回 `0..1` 分数

输入示例：

- 用户 prompt
- cwd
- 可选宿主 hint

### 4.2 expand

职责：

- 给出初始实体、关系、约束、产物定义

它不直接写入 ESR，只返回结构化计划。

### 4.3 validate

职责：

- 基于 ESR 当前上下文输出校验结果

它不直接改状态，只返回标准结果，由 adapter 再决定映射方式。

## 5. Adapter 协议

建议 adapter 输入 `Pack` 输出，产生 ESR 可执行变更：

```ts
interface ESRPackApplyPlan {
  entities: ...
  relations: ...
  artifacts: ...
  constraints: ...
  evaluations: ...
  memoryRefs: ...
  summary?: string
}
```

`adapter` 只做两件事：

1. 结构映射
2. 字段归一化

不做：

- 持久化
- 二次规划
- 复杂执行编排

## 6. 推荐执行流

```text
user request
  -> runtime chooses pack
  -> pack.detect()
  -> pack.expand()
  -> adapter maps to ESR operations
  -> ESR persists state
  -> pack.validate()
  -> adapter maps validation result to evaluation / constraint / closure views
```

## 7. 和现有 ESR v2 的关系

当前仓库已经具备：

- `ESRGraph`
- `getClosureStatus`
- `listClosureGaps`
- `listTasks`
- `attachMemoryRef`

因此 `Domain Pack` 不应重造：

- graph
- task lifecycle
- memory store
- task list

它只应把行业语义编译进这些能力。

## 8. 最小落地顺序

建议顺序：

1. 新增 `packages/domain-pack`
2. 定义 pack / adapter 协议
3. 实现 `software-pack` 示例
4. 增加 pack registry
5. 再考虑 `govdoc-pack`

不要一开始就做：

- marketplace
- 远程下载
- 动态安装
- pack 自定义脚本执行

这些都属于后期扩展，不适合当前阶段。

## 9. 设计边界

必须坚持：

- `ESR = 状态内核`
- `Pack = 行业规则包`
- `Adapter = 翻译层`

不能演变成：

- `ESR = 行业框架`
- `Pack = 持久化状态机`
- `Adapter = 第二 runtime`

## 10. 当前建议

下一步只实现：

- `packages/domain-pack/src/types.ts`
- `packages/domain-pack/src/adapter.ts`
- `packages/domain-pack/src/registry.ts`
- `packages/domain-pack/src/index.ts`
- `packages/domain-pack-software/src/index.ts`

先让协议成立，再考虑和 Pi / MCP 的实际选择逻辑对接。

## 11. 真实企业场景映射

当前仓库已对接并验证过两类真实企业语义：

### 11.1 Planning Review Pack

来源于真实“十五五规划审核”需求材料，典型审核维度包括：

- 战略对齐
- 指标完整性
- 口径一致性
- 文本与数据一致性
- 审核报告输出
- 整改跟踪与闭环

对应 pack：

- `planning-review`

并且已经开始吸收真实材料中的两类信息：

- `checks`
  - 章节完整性
  - 章节映射
  - 指标完整性
  - 举措逻辑性
  - 行文规范一致性
- `reference baselines`
  - 用国家标准或规范性文件作为要求来源
  - 在 `validate()` 中输出 `missing_requirement_section:*` 与 `missing_requirement_signal:*` 缺口
  - 同时输出结构化 `baselineDiffs`
    - `missingSections`
    - `missingSignals`
    - `weakSignals`
    - `suggestions`

### 11.2 GovDoc Pack

用于更泛化的公文 / 申请书 / 预算与政策依据场景。

对应 pack：

- `govdoc`

### 11.3 Software Pack

用于软件研发与工程闭环场景。

对应 pack：

- `software`

## 12. 与记忆系统的协同边界

为了兼容 Pi、Codex、Claude Code 以及外部记忆插件，当前架构增加了 `memory-bridge` 层。

它的职责不是保存 ESR 状态，而是：

- 探测宿主是否自带记忆机制
- 汇总记忆能力报告
- 选择合适的 provider
- 避免 ESR 与外部记忆系统重复持久化同一类信息

因此推荐边界是：

- `ESR Core` 保存结构化工程状态
- `Memory System` 保存长时经验、摘要、日志或检索索引
- `memory_ref` 负责桥接两者

## 13. 当前内建 Pack Market

当前仓库采用内建 registry，而不是远程市场：

- `software`
- `govdoc`
- `planning-review`

这样做的原因：

- 保持实现简单
- 保持测试可控
- 避免过早引入下载、安装、签名、权限模型

等 pack 协议与真实场景稳定后，再考虑外部化 market。

## 14. 基线差异的设计边界

`baselineDiffs` 的目标是让 Pack 输出更接近真实审核报告结构，但仍然坚持边界克制：

- 它只是 `validate()` 的结果字段
- 它不直接修改 ESR Core 状态
- 它不引入新的执行器
- 它不替代正式审核报告生成

推荐理解方式：

- `gaps` 用于轻量闭环和快速判定
- `baselineDiffs` 用于更细粒度的人机协同审核
- `reviewFindings` 用于更接近审核意见结构的发现列表
- `remediationItems` 用于更接近整改闭环执行的台账项

三者关系建议保持为：

- `gaps`：最粗粒度，可直接用于 closure / ready 判断
- `baselineDiffs`：中粒度，适合差异分析与整改映射
- `reviewFindings`：最接近业务输出，适合生成审核意见、问题清单、整改建议
- `remediationItems`：最接近执行闭环，适合责任建议、整改动作与验收标准

注意：

- `remediationItems.suggestedStatus` 只是建议初始状态
- 它不代表 Pack 持有整改生命周期
- 真正的整改进度仍应由 ESR task/state 或外部系统维护

真实场景选择原则：

- 规划审核 / 十五五 / 审核报告 / 整改闭环 -> `planning-review`
- 泛化公文 / 申请书 / 预算 + 政策依据 -> `govdoc`
- 代码 / 重构 / API / 测试 -> `software`
