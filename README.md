# RepoLens 🔍

> 帮 AI 编码助手（Claude Code / Codex CLI / DeepSeek Harness 等）省 token、更准确地读懂仓库 —— 用确定性分析替代盲目 grep。

## 为什么需要 RepoLens

AI 编码助手理解一个新仓库，通常要靠反复 `grep`、逐个读文件去"摸索"结构；每一次摸索都是一轮
工具调用，消耗大量 context token，而且结论容易随模型猜测漂移。

RepoLens 把这部分工作前移：用确定性的程序分析（目录树扫描 + manifest 解析 + 语言检测）预先
算出仓库画像（profile），缓存在仓库内的 `.repo-lens/` 目录里。agent 只需一次调用，就能拿到
结构化结论。

- ⚡ **省 token**：预计算的仓库画像一次调用给到结论，替代多轮盲目探索
- 🗄️ **跨会话缓存**：profile 落盘在 `<root>/.repo-lens/profile.json`，同一仓库反复分析不用重算
- 🎯 **确定性 > 臆测**：结论来自文件系统与 manifest 的真实解析，而非 LLM 猜测

## 三层架构

RepoLens 设计为「三层壳 + 一个内核」：

| 层 | 职责 | 状态 |
| --- | --- | --- |
| Skill 壳 | 每个 AI harness 一个薄 SKILL.md，教 agent 何时/如何调用内核 | 🚧 路线图 |
| MCP 壳 | 跨平台工具接口（get_repo_map 等） | 🚧 路线图 |
| 内核 CLI | 扫描 → 解析 → 分析 → 缓存 → 格式化输出 | ✅ 已实现（`packages/core` + `packages/cli`） |

当前可用的是**内核 CLI**；Skill 壳与 MCP 壳尚未实现，见下方路线图。整体设计详见
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 安装

### 环境要求

- Node.js >= 22.18
- pnpm

### 从源码构建（npm 包发布前的推荐方式）

```bash
git clone <repo-url>
cd repo-lens
pnpm install
pnpm build
```

构建产物为 `packages/cli/dist/index.js`，可直接运行：

```bash
node packages/cli/dist/index.js --help
```

建议建一个别名，下文用 `repo-lens` 指代：

```bash
alias repo-lens='node packages/cli/dist/index.js'
```

> npm 发布（届时可 `npx repo-lens ...`）在路线图中，尚未上线。

## 快速开始

```bash
# 分析仓库：生成 profile 并缓存到 <root>/.repo-lens/profile.json
repo-lens analyze .

# 以 JSON 输出完整 profile（跳过缓存写入）
repo-lens analyze . --json --no-cache

# 打印目录树地图（默认深度 4）
repo-lens map .
```

### 命令参考

#### `repo-lens analyze [dir=.] [--json] [--no-cache] [--no-gitignore]`

分析 `dir`（默认当前目录）生成 `RepoProfile` 并缓存；默认输出人类可读摘要。

| 选项 | 说明 |
| --- | --- |
| `--json` | 以 JSON 输出完整 profile（默认输出摘要） |
| `--no-cache` | 不写入 `.repo-lens/profile.json` |
| `--no-gitignore` | 不应用 .gitignore 过滤，扫描全部条目 |

#### `repo-lens map [dir=.] [--max-depth N=4] [--no-cache]`

打印目录树地图；优先读取已有缓存，缓存不存在时现场分析。

| 选项 | 说明 |
| --- | --- |
| `--max-depth N` | 树的最大深度，默认 4 |
| `--no-cache` | 不读取缓存，现场重新分析 |

#### 通用

- `--help` / `-h`、`--version` / `-v`
- 错误统一输出到 stderr（`repo-lens: <消息>`），进程退出码 1；目录不存在会给出明确错误

## Monorepo 结构

pnpm workspace（`packages/*`）+ TypeScript project references（`tsc -b` 增量构建）。

| 路径 | 包 | 说明 |
| --- | --- | --- |
| `packages/core` | `@repo-lens/core` | 分析内核：目录树扫描、manifest 解析、语言检测、profile 缓存与格式化 |
| `packages/cli` | `@repo-lens/cli` | 命令行壳：`repo-lens analyze` / `repo-lens map`，bin 名 `repo-lens` |

测试基于 Node 内置的 `node:test`，入口为 `packages/core/test/`。

## 从代码调用（core API）

`@repo-lens/core` 导出可编程 API，CLI 只是它的一层薄壳：

| API | 签名 / 说明 |
| --- | --- |
| `analyzeRepo` | `analyzeRepo(root: string, options?: { gitignore?: boolean; ignoreDirs?: string[] }): Promise<RepoProfile>` —— 一站式分析入口 |
| `scanTree` | 扫描目录树，产出 `DirEntry` 结构 |
| `parseManifests` | 解析仓库中的依赖清单（如 `package.json`） |
| `detectLanguage` | 基于文件扩展名的语言检测与统计 |
| `saveProfile` | `saveProfile(profile: RepoProfile): Promise<string>` —— 写入 `<root>/.repo-lens/profile.json`，返回写入路径 |
| `loadProfile` | `loadProfile(root: string): Promise<RepoProfile \| null>` —— 读取缓存，不存在返回 `null` |
| `formatTree` | `formatTree(tree: DirEntry, opts?: { maxDepth?: number }): string` |
| `formatSummary` | `formatSummary(profile: RepoProfile): string` |

数据流、profile schema 与扩展方式详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 路线图

- [x] 项目初始化（monorepo / TypeScript project references）
- [x] 核心内核（已实现）：目录树扫描、manifest 解析、语言检测、profile 缓存、文本格式化
- [x] CLI 壳（已实现）：`analyze` / `map` 命令
- [ ] AST 级结构提取与调用链追踪（TS/JS 先行）
- [ ] MCP server 壳
- [ ] Claude Code / DSH skill 壳
- [ ] Codex CLI 适配
- [ ] npm 发布与 Marketplace 上架

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

MIT
