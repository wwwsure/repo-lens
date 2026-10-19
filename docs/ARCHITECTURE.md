# RepoLens 架构

本文档描述 RepoLens 的三层架构、分析数据流、`.repo-lens/profile.json` 缓存格式，以及如何
扩展新语言 / 新 manifest。

## 三层壳 + 一个内核

RepoLens 的目标是让任意 AI 编码 harness 都能低成本读仓库。为此架构上分成三层壳，三层共享
同一个内核：

```
┌────────────────────────────────────────────────────────┐
│ Skill 壳   每个 harness 一个薄 SKILL.md          🚧    │
├────────────────────────────────────────────────────────┤
│ MCP 壳     跨平台工具接口（get_repo_map 等）    🚧    │
├────────────────────────────────────────────────────────┤
│ 内核 CLI   packages/cli（analyze / map）         ✅    │
├────────────────────────────────────────────────────────┤
│ 分析引擎   packages/core                            ✅    │
└────────────────────────────────────────────────────────┘
```

各层职责：

- **分析引擎**（`packages/core`）：全部确定性逻辑 —— 目录树扫描、manifest 解析、语言检测、
  profile 组装、缓存读写、文本格式化。对上层只暴露函数 API（见 README 的 core API 表）。
- **内核 CLI**（`packages/cli`）：已实现的唯一一层壳。只做三件事：解析命令行参数 → 调用 core
  API → 选择输出格式（JSON / 摘要 / 目录树）。
- **MCP 壳**（路线图）：把内核能力暴露为 MCP tools，供 Claude Code / Codex CLI / Cursor 等
  通过 MCP 协议调用。
- **Skill 壳**（路线图）：每家 harness 一个 SKILL.md，教 agent 什么场景该调用 repo-lens、
  如何解释输出。

设计原则：**所有智能都在内核里，壳只做协议适配**。新增一个 harness 只需要加一个薄壳，不复制
分析逻辑；内核新增能力时所有壳自动获得。

## 数据流

一次 `repo-lens analyze` 的流水线（全部确定性步骤，不含任何 LLM 推理）：

```
scan ──> manifest ──> language ──> analyze ──> cache ──> format
```

1. **scan**（`scanTree`）：递归扫描 `root` 目录树，产出 `DirEntry` 结构（目录 / 文件节点）；
   按 `.gitignore` 与 `ignoreDirs` 过滤。
2. **manifest**（`parseManifests`）：读取仓库中的依赖清单文件（如 `package.json`），提取项目
   自述信息（名称、依赖等）。
3. **language**（`detectLanguage`）：基于文件扩展名统计各语言的文件分布。
4. **analyze**（`analyzeRepo`）：汇总统成 `RepoProfile`。`analyzeRepo` 是 1–3 步的编排入口，
   支持 `options.gitignore` 与 `options.ignoreDirs`。
5. **cache**（`saveProfile` / `loadProfile`）：把 `RepoProfile` 序列化写入
   `<root>/.repo-lens/profile.json`；`loadProfile` 反向读取，缓存不存在时返回 `null`。
6. **format**（`formatSummary` / `formatTree`）：把 `RepoProfile` 或 `DirEntry` 渲染为人类
   可读文本。

CLI 两个命令对流水线的用法：

- `analyze`：跑完整流水线并缓存（除非 `--no-cache`）；`--json` 输出 profile 原始 JSON，
  否则 `formatSummary` 输出摘要。
- `map`：优先 `loadProfile` 读缓存，缓存缺失才现场分析；`--no-cache` 跳过缓存直接现场
  分析；最终用 `formatTree`（`--max-depth`，默认 4）输出目录树。

## profile 缓存：`.repo-lens/profile.json`

### 为什么缓存在仓库内

- **跨会话复用**：agent 每次会话不用重扫仓库，一次分析多次消费。
- **确定性输入**：同一份 profile 给所有会话、所有 agent，结论一致、可复核。
- **可弃可换**：它是纯生成物。本仓库默认把 `.repo-lens/` 加入 `.gitignore`（生成物不入库）；
  团队也可以选择提交入库以共享缓存。删除该目录不影响正确性，下次 `analyze` 会重建。

### 逻辑 schema

`RepoProfile` 的逻辑结构如下。字段最终以 `@repo-lens/core` 导出的 `RepoProfile` 类型定义
为准（core 与文档并行开发中，如有出入以代码为准）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schemaVersion` | `number` | profile 格式版本，便于未来格式迁移 |
| `root` | `string` | 被分析仓库的根路径 |
| `generatedAt` | `string` | 生成时间（ISO 8601） |
| `tree` | `DirEntry` | 目录树根节点（scan 步骤的产物） |
| `languages` | `Record<string, ...>` | 语言 → 统计（文件分布等，language 步骤的产物） |
| `manifests` | `...[]` | 解析出的依赖清单摘要（manifest 步骤的产物） |
| `stats` | `...` | 汇总统计（文件 / 目录规模等） |

### 版本与兼容

- `schemaVersion` 不匹配时，调用方可视为缓存失效并重新分析。
- `--no-cache` 绕过缓存：`analyze` 不写缓存，`map` 不读缓存。

## 扩展点

内核的两个主要扩展点：新增语言检测、新增 manifest 类型。两者都遵循同一原则 ——
**新增能力落在 core，壳零改动**。

### 新增语言检测

`detectLanguage` 靠「文件扩展名 → 语言」映射工作。新增一种语言（如 Rust）：

1. 在 `@repo-lens/core` 的语言映射中增加扩展名条目（如 `.rs` → `Rust`）。
2. 在 `packages/core/test/` 增加对应用例（`node:test`）。
3. `pnpm build && pnpm test`，验证 `repo-lens analyze . --json` 的 `languages` 中出现新语言。

### 新增 manifest 类型

`parseManifests` 目前认识 `package.json` 之类的依赖清单。新增一类 manifest（如
`pyproject.toml` / `Cargo.toml`）：

1. 在 core 的 manifest 解析逻辑中注册新的文件名与解析方式，输出统一的 manifest 摘要结构。
2. 补充测试：构造样例 manifest，断言解析出的名称 / 依赖等字段。
3. `pnpm build && pnpm test`。

## CLI 壳设计（`packages/cli`）

- ESM + TypeScript strict，NodeNext 风格（相对导入带 `.js` 扩展名）。
- bin 名 `repo-lens`，入口带 `#!/usr/bin/env node` shebang。
- 依赖 `@repo-lens/core`（`workspace:*`），自身不含分析逻辑。
- 错误约定：所有错误写 stderr，格式 `repo-lens: <消息>`，进程退出码 1；目录不存在等输入
  错误给出明确消息。

## 构建与测试

- **TypeScript project references**：根 `tsconfig.json` 引用 `packages/core` 与
  `packages/cli`，`pnpm build` 即 `tsc -b` 增量构建；公共编译选项收敛在 `tsconfig.base.json`
  （ES2022 / NodeNext / strict / declaration）。
- **测试**：Node 内置 `node:test`，`pnpm test` 运行 `packages/core/test/`，无额外测试框架依赖。
