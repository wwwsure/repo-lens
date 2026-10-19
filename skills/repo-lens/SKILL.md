---
name: repo-lens
description: Analyze a local or cloned GitHub repository cheaply and deterministically for AI agents — directory tree, language stats, dependency manifests, and call chains — with a cross-session cache in <repo>/.repo-lens/profile.json. Use whenever the user wants to understand, analyze, summarize, map, or explore a repository (GitHub or local), including direct phrases such as 分析仓库, 分析这个仓库, 分析一下这个仓库/项目, 帮我看看这个仓库/项目, 了解项目结构, 这个项目是做什么的, 梳理代码结构, repository structure, codebase overview, understand this repo — also for listing languages/dependencies/entry points, getting a directory-tree overview (目录树), tracing a call chain (调用链), or saving tokens reading an unfamiliar codebase before deep-diving files. No need for the user to mention repo-lens by name.
license: MIT
metadata:
  version: "0.1.0"
  author: wwwsure
---

# repo-lens

Deterministic repository analysis for AI agents. Instead of `ls -R` + reading package manifests + globbing source files across many tool calls, run one `repo-lens` command and get a compact, token-cheap profile.

## When to use

- User shares a repo URL or local path and wants to understand it → clone (if needed) then `repo-lens analyze`.
- Need the directory shape before deciding which files to read → `repo-lens map`.
- Need to know languages, dependencies, entry points, workspaces → `repo-lens analyze` (manifest section).
- Need to trace who calls what in a TS/JS codebase → `repo-lens chain`.
- Re-visiting a repo in a later session → cache hit: profile loads from `.repo-lens/profile.json` instantly.

## Commands

```bash
# Full profile: files/dirs/size, language distribution, manifests (npm/pyproject/Cargo/go.mod)
repo-lens analyze <dir>            # human-readable summary
repo-lens analyze <dir> --json     # full RepoProfile JSON (schemaVersion 1)
repo-lens analyze <dir> --no-cache # skip writing .repo-lens/profile.json
repo-lens analyze <dir> --no-gitignore  # don't honor the repo's .gitignore

# Directory tree (ASCII), depth-limited; reads cache first, recomputes if missing
repo-lens map <dir>                # default: cached profile
repo-lens map <dir> --max-depth 2
repo-lens map <dir> --no-cache     # force fresh scan

# Call chains in TS/JS codebases (identifier calls only; member calls skipped)
repo-lens chain <file[:symbol]> --dir <repo>
repo-lens chain src/index.ts:main --dir <repo> --max-depth 3
repo-lens chain src/index.ts --dir <repo> --json
```

`<dir>` defaults to `.` for analyze/map. Errors print `repo-lens: <msg>` to stderr and exit 1.

## Cache semantics

- `analyze` writes `<repo>/.repo-lens/profile.json` (schemaVersion 1) unless `--no-cache`.
- `map` and `chain` prefer the cache; `--no-cache` recomputes without writing.
- The cache is a plain JSON profile (tree, languages, manifests). It is gitignored by default; teams may choose to commit it.
- If the cache is stale after big changes, re-run `repo-lens analyze <dir>`.

## How to consume the output

- For a quick orientation: use `analyze` summary output directly, quote the top languages + manifest facts.
- For feeding another tool/model: use `--json` and trim to what's needed (languages, manifests, tree) — the tree can be large on big repos; prefer `map --max-depth` for the shape.
- For deep-diving: run `analyze` first, pick interesting paths from the tree, then read those files directly. Do NOT read node_modules/dist/build (already excluded by default).
- Supported manifests: package.json (incl. workspaces, entry points), pyproject.toml (PEP 621 + poetry), Cargo.toml, go.mod.

## Requirements

Node >= 22.18. Built from source at `D:\vibe-coding\repo-lens` (pnpm monorepo: packages/core + packages/cli + packages/mcp-server). `repo-lens` is on PATH via `npm link`.

## Installation

Copy this directory into your agent's skills folder:

| Harness | Path |
| --- | --- |
| DeepSeek Harness | `C:\Users\WS\.agents\skills\repo-lens\` |
| Claude Code | `~/.claude/skills/repo-lens/` |
| Codex | `~/.codex/skills/repo-lens/` |

```bash
# from the repo root, after `pnpm install && pnpm build && npm link -w packages/cli`
cp -r skills/repo-lens ~/.claude/skills/
cp -r skills/repo-lens ~/.codex/skills/
```

The skill only wraps the CLI — it adds no runtime dependency. Once installed, say things like
"分析这个仓库", "了解项目结构", or "understand this repo" and the agent will pick repo-lens automatically.
