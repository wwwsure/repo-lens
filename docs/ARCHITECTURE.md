# RepoLens 架构

本文档描述 RepoLens 的三层架构、分析数据流、`.repo-lens/profile.json` 缓存格式、MCP 壳设计，
以及如何扩展新语言 / 新 manifest / 新调用图支持。

## 三层壳 + 一个内核

RepoLens 的目标是让任意 AI 编码 harness 都能低成本读仓库。为此架构上分成三层壳，三层共享
同一个内核：

```
┌──────────────────────────────────────────────────────────────┐
│ Skill 壳   每个 harness 一个薄 SKILL.md                ✅    │
├──────────────────────────────────────────────────────────────┤
│ MCP 壳     stdio 传输，repo_lens_analyze/map/profile  ✅    │
├──────────────────────────────────────────────────────────────┤
│ 内核 CLI   packages/cli（analyze / map / chain）       ✅    │
├──────────────────────────────────────────────────────────────┤
│ 分析引擎   packages/core（含 AST 调用图）             ✅    │
└──────────────────────────────────────────────────────────────┘
```

各层职责：

- **分析引擎**（`packages/core`）：全部确定性逻辑 —— 目录树扫描、manifest 解析、语言识别、
  profile 组装、缓存读写、AST 调用图、文本格式化。对上层只暴露函数 API（见 README 的
  core API 表）。
- **内核 CLI**（`packages/cli`）：解析命令行参数 → 调用 core API → 选择输出格式
  （JSON / 摘要 / 目录树 / 调用链树）。所有失败以 `repo-lens: <消息>` 写 stderr 并 exit 1。
- **MCP 壳**（`packages/mcp-server`）：把内核能力暴露为 MCP tools（stdio 传输），供
  Claude Code / DSH / Codex 等 MCP 宿主调用。工具保持无副作用（不写缓存）。
- **Skill 壳**：每家 harness 一个薄 SKILL.md，教 agent 什么场景该调用 repo-lens、如何解释
  输出。

设计原则：**所有智能都在内核里，壳只做协议适配**。新增一个 harness 只需要加一个薄壳，不复制
分析逻辑；内核新增能力时所有壳自动获得。

## 数据流

### profile 流水线（analyze）

全部确定性步骤，不含任何 LLM 推理：

```
scan ──> manifest ──> language ──> analyze ──> cache ──> format
```

1. **scan**（`scanTree(root, options?: ScanOptions)`）：递归扫描目录树，产出
   `ScanResult`（`DirNode` 树 + 文件/目录计数 + 总字节 + 按语言聚合统计）；遵循 `.gitignore`
   （可用 `gitignore: false` 关闭）与 `ignoreDirs`，并内置 `DEFAULT_IGNORE_DIRS`
   （node_modules / .git / dist 等）。
2. **manifest**（`parseManifests`）：解析**仓库根目录**的依赖清单 —— `package.json`（npm）、
   `pyproject.toml`（Python）、`Cargo.toml`（Rust）、`go.mod`（Go）—— 产出 `ManifestInfo[]`
   （名称、版本、依赖数、脚本、入口等）。
3. **language**（`detectLanguage(filePath)`）：单文件语言识别，先查特殊文件名
   （`NAME_LANGUAGES`，如 `Dockerfile`、`go.mod`），再查扩展名（`EXTENSION_LANGUAGES`，
   覆盖 TS/JS/Python/Rust/Go/Java 等 50+ 扩展名）。聚合统计在 scan 步完成。
4. **analyze**（`analyzeRepo(root, options?)`）：汇总统成 `RepoProfile`，是 1–3 步的编排
   入口。
5. **cache**（`saveProfile` / `loadProfile`）：读写 `<root>/.repo-lens/profile.json`；
   `loadProfile` 缓存缺失返回 `null`。
6. **format**（`formatSummary` / `formatTree` / `formatBytes`）：渲染为人类可读文本。

### 调用图流水线（chain）

```
scan ──> parse AST ──> resolve imports ──> call edges ──> BFS chain
```

1. **scan**：复用 `scanTree` 的清单与忽略规则，筛出源文件（`.ts` / `.tsx` / `.mts` /
   `.js` / `.jsx` / `.mjs`）。
2. **parse AST**（`analyzeCallGraph` 内部）：用 TypeScript 编译器 API 的
   `createSourceFile` + 手动遍历（**不做 type-check**）抽取每文件的 import、顶层声明
   （function / class / 顶层 const）、导出名与标识符调用点（含行号）。
3. **resolve imports**：只有相对 specifier（`./x`、`../x`）尝试解析为仓库内文件（支持
   NodeNext 风格 `./x.js` → `x.ts` 与 `index.*` 探测）；bare specifier 视为外部。
4. **call edges**：`foo()` 形式的调用若命中 (a) 同文件顶层声明，或 (b) 本地 import 绑定且
   目标文件声明/导出该符号，则产生 `CallEdge`；边归属于包裹它的顶层声明（模块作用域调用
   不产生边）。产出 `CallGraph{root, files: FileAst[], edges}`。
5. **BFS chain**（`resolveChain(graph, entry, maxDepth = 3)`）：从入口
   （`file` = 全部顶层符号 / `file:Symbol` = 指定符号）BFS 展开，最浅路径优先，产出
   `ChainResult{entry, steps, truncated}`。CLI 以 `file::name` 缩进树渲染，节点标注
   `via` 发现者与调用行号。

### CLI 与 MCP 对流水线的用法

| 入口 | 行为 |
| --- | --- |
| `repo-lens analyze` | 跑完整 profile 流水线并写缓存（除非 `--no-cache`）；`--json` 输出原始 JSON，否则摘要 |
| `repo-lens map` | 优先 `loadProfile` 读缓存，缺失则现场分析（不写缓存）；`formatTree` 输出，`--max-depth` 缺省 4 |
| `repo-lens chain` | 现场构建调用图（不缓存）+ BFS 调用链；`--max-depth` 缺省 3 |
| MCP `repo_lens_analyze` | 现场分析，**不写缓存**（工具无副作用） |
| MCP `repo_lens_map` | `loadProfile` ?? `analyzeRepo`；`maxDepth` 省略为不限深度 |
| MCP `repo_lens_profile` | 仅 `loadProfile`；无缓存时返回提示文本 |

## profile 缓存：`.repo-lens/profile.json`

### 为什么缓存在仓库内

- **跨会话复用**：agent 每次会话不用重扫仓库，一次分析多次消费。
- **确定性输入**：同一份 profile 给所有会话、所有 agent，结论一致、可复核。
- **可弃可换**：它是纯生成物。本仓库默认把 `.repo-lens/` 加入 `.gitignore`（生成物不入库）；
  团队也可以选择提交入库以共享缓存。删除该目录不影响正确性，下次 `analyze` 会重建。
- **写入方**：只有 CLI `analyze` 会写缓存（`saveProfile`）；`map` 与 MCP 工具只读。

### Schema（`RepoProfile`，schemaVersion = 1）

字段以 `@repo-lens/core` 导出的 `RepoProfile` 类型为准：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schemaVersion` | `1` | schema 版本，缓存校验用 |
| `root` | `string` | 仓库根目录绝对路径 |
| `name` | `string` | 项目名（优先取 manifest 的 name，否则取目录名） |
| `generatedAt` | `string` | ISO 8601 时间戳 |
| `files` | `number` | 文件总数 |
| `dirs` | `number` | 目录总数 |
| `bytes` | `number` | 总字节数 |
| `languages` | `LanguageStat[]` | `{ name, files, bytes }`，按字节数降序 |
| `manifests` | `ManifestInfo[]` | 根目录依赖清单解析结果（npm / python / rust / go） |
| `tree` | `DirNode` | 完整目录树（`DirNode{ name, path, type:'dir', children, fileCount }`，文件为 `FileNode{ name, path, type:'file', size, language }`） |

### 版本与兼容

- `schemaVersion` 不匹配时，调用方可视为缓存失效并重新分析。
- `--no-cache` 绕过缓存：`analyze` 不写缓存，`map` 不读缓存。

## MCP 壳设计（`packages/mcp-server`）

- bin 名 `repo-lens-mcp`，stdio 传输（`@modelcontextprotocol/sdk` + zod 入参校验）。
- 工具集（v1）：`repo_lens_analyze{dir?, json?}`、`repo_lens_map{dir?, maxDepth?}`、
  `repo_lens_profile{dir?}`；`dir` 缺省为 server 进程 cwd。
- **无副作用**：`repo_lens_analyze` 不调用 `saveProfile`；需要写缓存请用 CLI。
- 错误统一转成 `isError: true` + `Error: <消息>` 文本，server 不崩溃（目录不存在、非目录等）。
- 冒烟脚本 `scripts/smoke.mjs`：spawn `dist/index.js`，走 initialize → tools/list（校验恰好
  三工具）→ tools/call 错误路径，不依赖任何 LLM。

## 扩展点

内核的三个主要扩展点都遵循同一原则：**新增能力落在 core，壳零改动**。

### 新增语言识别

`detectLanguage` 靠两张映射表工作：

1. `EXTENSION_LANGUAGES`（`packages/core/src/languages.ts`）：扩展名 → 语言名。
2. `NAME_LANGUAGES`：无扩展名的特殊文件名 → 语言名（如 `Dockerfile`、`Makefile`）。

新增语言：在对应表加条目 → 在 `packages/core/test/` 增加用例（`node:test`）→
`pnpm build && pnpm test`，验证 `repo-lens analyze . --json` 的 `languages` 出现新语言。

### 新增 manifest 类型

`parseManifests`（`packages/core/src/manifest.ts`）目前认识仓库根目录的
`package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod`。新增一类（如 `composer.json`）：

1. 在 `parseManifests` 注册新文件名与解析逻辑，产出统一的 `ManifestInfo`（`type` 联合类型
   同步扩展）。
2. 补测试：构造样例 manifest，断言名称 / 依赖数等字段。
3. `pnpm build && pnpm test`。

### 扩展调用图到其他语言

调用图目前绑定 TypeScript 编译器 API（TS/JS 家族）。扩展新语言（如 Python）需要在
`packages/core/src/ast.ts` 增加对应的轻量解析器，产出与 `FileAst` 等价的结构（imports /
declarations / exports / calls），边解析与 BFS 部分可整体复用。

## CLI 壳设计（`packages/cli`）

- ESM + TypeScript strict，NodeNext 风格（相对导入带 `.js` 扩展名）。
- bin 名 `repo-lens`，入口带 `#!/usr/bin/env node` shebang。
- 自实现轻量参数解析（`src/args.ts`），依赖仅 `@repo-lens/core`（`workspace:*`）。
- `--version` 读取自身 `package.json`；`chain` 的入口格式 `file[:symbol]` 兼容 Windows 盘符
  （`C:/x.ts` 不会被误判 symbol 分隔符）。

## 构建与测试

- **TypeScript project references**：根 `tsconfig.json` 引用 `packages/core`、
  `packages/cli`、`packages/mcp-server`，`pnpm build` 即 `tsc -b` 增量构建；公共编译选项
  收敛在 `tsconfig.base.json`（ES2022 / NodeNext / strict / declaration /
  rewriteRelativeImportExtensions）。
- **测试**：Node 内置 `node:test`，`pnpm test` 运行 `packages/core/test/*.test.ts`
  （34 个用例）；`pnpm --filter @repo-lens/mcp-server smoke` 跑 MCP 冒烟脚本。
