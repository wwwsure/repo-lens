# RepoLens 🔍

> 帮 AI 编码助手（Claude Code / Codex CLI / DeepSeek Harness 等）省 token、更准确地读懂仓库 —— 用确定性分析替代盲目 grep。

## 为什么需要 RepoLens

AI 编码助手理解一个新仓库，通常要靠反复 `grep`、逐个读文件去"摸索"结构；每一次摸索都是一轮
工具调用，消耗大量 context token，而且结论容易随模型猜测漂移。

RepoLens 把这部分工作前移：用确定性的程序分析（目录树扫描 + manifest 解析 + 语言识别 +
AST 调用图）预先算出仓库画像（profile），缓存在仓库内的 `.repo-lens/` 目录里。agent 只需
一次调用，就能拿到结构化结论。

- ⚡ **省 token**：预计算的仓库画像一次调用给到结论，替代多轮盲目探索
- 🗄️ **跨会话缓存**：profile 落盘在 `<root>/.repo-lens/profile.json`，同一仓库反复分析不用重算
- 🎯 **确定性 > 臆测**：结论来自文件系统、manifest 与 AST 的真实解析，而非 LLM 猜测

## 三层架构

RepoLens 的「三层壳 + 一个内核」已全部落地：

| 层 | 职责 | 状态 |
| --- | --- | --- |
| Skill 壳 | 每个 AI harness 一个薄 SKILL.md，教 agent 何时/如何调用内核 | ✅ 已实现 |
| MCP 壳 | 跨平台工具接口（repo_lens_analyze / repo_lens_map / repo_lens_profile） | ✅ 已实现 |
| 内核 CLI | 扫描 → 解析 → 分析 → 缓存 → 格式化，含 AST 调用链（analyze / map / chain） | ✅ 已实现 |

整体设计（数据流、profile schema、扩展方式）详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 安装

### 环境要求

- Node.js >= 22.18
- pnpm

### 从源码构建

```bash
git clone https://github.com/wwwsure/repo-lens.git
cd repo-lens
pnpm install
pnpm build
```

构建产物：

- `packages/cli/dist/index.js` —— CLI（bin 名 `repo-lens`）
- `packages/mcp-server/dist/index.js` —— MCP server（bin 名 `repo-lens-mcp`）

建议为 CLI 建一个别名，下文用 `repo-lens` 指代：

```bash
alias repo-lens='node packages/cli/dist/index.js'
```

### npm（进行中，待发布）

包名已确认可用：`repo-lens`（CLI）、`@repo-lens/core`、`@repo-lens/mcp-server`；发布方式
`pnpm publish -r`。发布后即可 `npx repo-lens ...` / `npm install -g repo-lens`，当前请从
源码构建使用。

## 快速开始

```bash
# 1. 分析仓库：生成 profile 并缓存到 <root>/.repo-lens/profile.json
repo-lens analyze .

# 2. 目录树地图（优先读缓存，默认深度 4）
repo-lens map .

# 3. 调用链追踪（AST 级，默认深度 3）
repo-lens chain src/args.ts:parseArgs --dir .
```

### 命令参考

#### `repo-lens analyze [dir=.] [--json] [--no-cache] [--no-gitignore]`

分析 `dir`（默认当前目录）生成 `RepoProfile` 并缓存；默认输出人类可读摘要。

| 选项 | 说明 |
| --- | --- |
| `--json` | 以 JSON 输出完整 profile（默认输出摘要） |
| `--no-cache` | 不写入 `.repo-lens/profile.json` |
| `--no-gitignore` | 不遵循 .gitignore，扫描全部目录 |

#### `repo-lens map [dir=.] [--max-depth N=4] [--no-cache]`

打印目录树地图；优先读取已有缓存，缓存不存在时现场分析（不写缓存）。

| 选项 | 说明 |
| --- | --- |
| `--max-depth N` | 目录树最大深度，默认 4 |
| `--no-cache` | 不读取缓存，现场重新分析 |

#### `repo-lens chain <file[:symbol]> [--dir .] [--max-depth N=3] [--json]`

AST 级调用链分析：构建 `dir` 内的调用图，从 `<file>`（该文件全部顶层符号）或
`<file:Symbol>`（指定符号）出发，BFS 展开调用链。输出 `file::name` 缩进树，每个节点标注
发现者（via）与调用行号；超出深度会截断并提示。

| 选项 | 说明 |
| --- | --- |
| `--dir dir` | 要扫描的仓库根目录，缺省为当前目录 |
| `--max-depth N` | 调用链深度，缺省 3 |
| `--json` | 输出 `ChainResult` JSON（entry / steps / truncated） |

```bash
repo-lens chain src/index.ts --dir .                        # 整个文件的顶层符号
repo-lens chain src/args.ts:parseArgs --dir . --max-depth 5 # 指定符号、指定深度
```

解析规则（确定性、刻意轻量，基于 TypeScript 编译器 API 的 AST，不做类型检查）：

- 支持 `.ts` / `.tsx` / `.mts` / `.js` / `.jsx` / `.mjs` 源文件
- 只有相对 import（`./x`、`../x`）可解析为仓库内文件；bare specifier（路径别名、
  node_modules 包）视为外部，不产生调用边
- 只追踪标识符调用 `foo()`；成员调用 `x.foo()` 不在范围内

#### 通用

- `--help` / `-h`、`--version` / `-v`
- 错误统一输出到 stderr（`repo-lens: <消息>`），进程退出码 1；目录不存在、符号不存在等
  会给出明确错误

## 在 MCP 宿主中使用（DSH / Claude Code / Codex）

`@repo-lens/mcp-server` 通过 stdio 暴露三个工具（v1）：

| 工具 | 入参 | 行为 |
| --- | --- | --- |
| `repo_lens_analyze` | `dir?`、`json?` | 现场分析，**不写缓存（无副作用）**；`json=true` 返回 RepoProfile JSON，否则返回文本摘要 |
| `repo_lens_map` | `dir?`、`maxDepth?` | 优先读缓存，缺失则现场分析；返回 ASCII 目录树（`maxDepth` 省略为不限深度） |
| `repo_lens_profile` | `dir?` | 返回缓存的 `profile.json`；无缓存时提示先运行 `repo_lens_analyze` |

错误（目录不存在等）统一返回 `isError: true` + 错误消息，server 不崩溃。

接入配置（`mcpServers`，发布后用 bin 名）：

```json
{
  "mcpServers": {
    "repo-lens": {
      "command": "repo-lens-mcp"
    }
  }
}
```

从源码运行（发布前）：

```json
{
  "mcpServers": {
    "repo-lens": {
      "command": "node",
      "args": ["D:/vibe-coding/repo-lens/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Claude Code 可写入用户级 `~/.claude.json` 或项目级 `.mcp.json`；DSH / Codex 等宿主以各自
文档的 MCP 配置方式为准。冒烟验证：

```bash
pnpm --filter @repo-lens/mcp-server smoke
```

## Monorepo 结构

pnpm workspace（`packages/*`）+ TypeScript project references（`tsc -b` 增量构建）。

| 路径 | 包 | 说明 |
| --- | --- | --- |
| `packages/core` | `@repo-lens/core` | 分析内核：目录树扫描、manifest 解析、语言识别、profile 缓存、AST 调用图 |
| `packages/cli` | `@repo-lens/cli` | 命令行壳：`analyze` / `map` / `chain`，bin 名 `repo-lens` |
| `packages/mcp-server` | `@repo-lens/mcp-server` | MCP 壳：stdio 传输，三工具，bin 名 `repo-lens-mcp` |

测试：Node 内置 `node:test`，共 34 个用例（`packages/core/test/`）；MCP server 另有冒烟脚本
`packages/mcp-server/scripts/smoke.mjs`。

## 从代码调用（core API）

`@repo-lens/core` 导出可编程 API，CLI / MCP 壳只是它的薄壳：

| API | 签名 / 说明 |
| --- | --- |
| `analyzeRepo` | `analyzeRepo(root: string, options?: { gitignore?: boolean; ignoreDirs?: string[] }): Promise<RepoProfile>` —— 一站式分析入口 |
| `analyzeCallGraph` | `analyzeCallGraph(root: string, options?: ScanOptions): Promise<CallGraph>` —— 构建仓库内调用图 |
| `resolveChain` | `resolveChain(graph: CallGraph, entry: string, maxDepth = 3): ChainResult` —— 从入口 BFS 展开调用链 |
| `scanTree` | `scanTree(root: string, options?: ScanOptions): Promise<ScanResult>` —— 目录树扫描 |
| `parseManifests` | 解析仓库根目录的依赖清单（npm / Python / Rust / Go） |
| `detectLanguage` | `detectLanguage(filePath: string): string \| null` —— 单文件语言识别（扩展名 + 特殊文件名） |
| `saveProfile` | `saveProfile(profile: RepoProfile): Promise<string>` —— 写入 `<root>/.repo-lens/profile.json`，返回写入路径 |
| `loadProfile` | `loadProfile(root: string): Promise<RepoProfile \| null>` —— 读取缓存，不存在返回 `null` |
| `formatTree` | `formatTree(tree: DirEntry, opts?: { maxDepth?: number }): string` |
| `formatSummary` | `formatSummary(profile: RepoProfile): string` |

主要类型：`RepoProfile`、`DirEntry` / `DirNode` / `FileNode`、`LanguageStat`、`ManifestInfo`、
`CallGraph`、`CallEdge`、`ChainResult`、`ChainStep`、`FileAst`、`SymbolRef`。

数据流、profile schema 与扩展方式详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 路线图

- [x] 项目初始化（monorepo / TypeScript project references）
- [x] 核心内核：目录树扫描、manifest 解析、语言识别、profile 缓存、文本格式化
- [x] CLI 壳：`analyze` / `map` / `chain` 命令
- [x] AST 调用链追踪（TypeScript 编译器 API）
- [x] MCP server 壳（stdio，三工具，DSH / Claude Code / Codex 可接入）
- [x] Claude Code / DSH skill 壳
- [ ] npm 发布（进行中：包名已确认可用，`pnpm publish -r`，待最终确认）
- [ ] Marketplace 上架

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

MIT
