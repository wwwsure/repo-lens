#!/usr/bin/env node
/**
 * repo-lens MCP server (stdio transport).
 *
 * Exposes three tools to MCP hosts (DSH / Claude Code / Codex):
 *   - repo_lens_analyze : fresh analysis, no cache writes (side-effect free)
 *   - repo_lens_map     : ASCII directory tree (cached profile preferred)
 *   - repo_lens_profile : raw cached .repo-lens/profile.json
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { analyzeRepo, formatSummary, formatTree, loadProfile } from '@repo-lens/core';

const SERVER_VERSION = '0.1.0';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function fail(err: unknown): ToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}

/** Resolve the target directory (default: server cwd) and verify it exists. */
async function resolveDir(dir?: string): Promise<string> {
  const root = path.resolve(dir && dir.trim() !== '' ? dir : process.cwd());
  let stats;
  try {
    stats = await stat(root);
  } catch {
    throw new Error(`directory not found: ${root}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }
  return root;
}

/** Run a tool body, converting any thrown error into an isError result. */
async function guard(body: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await body();
  } catch (err) {
    return fail(err);
  }
}

const server = new McpServer({ name: 'repo-lens-mcp', version: SERVER_VERSION });

server.tool(
  'repo_lens_analyze',
  'Analyze a repository and return a compact overview: file/dir counts, total bytes, language distribution, dependency manifests and a directory tree. ' +
    'Use this first when you need to understand an unfamiliar codebase (what languages it uses, what packages it depends on, how big it is). ' +
    'This tool performs a fresh scan and never writes the cache, so it is side-effect free. ' +
    'Pass json=true for the full machine-readable profile; otherwise you get a human-readable summary.',
  {
    dir: z
      .string()
      .optional()
      .describe('Directory to analyze. Defaults to the MCP server process working directory.'),
    json: z.boolean().optional().describe('Return the full RepoProfile as JSON instead of a text summary.'),
  },
  async ({ dir, json }) =>
    guard(async () => {
      const root = await resolveDir(dir);
      const profile = await analyzeRepo(root);
      return ok(json === true ? JSON.stringify(profile, null, 2) : formatSummary(profile));
    }),
);

server.tool(
  'repo_lens_map',
  'Print an ASCII directory tree of a repository so you can find where files live before reading them. ' +
    'Uses the cached .repo-lens/profile.json when present; falls back to a fresh analysis (without writing cache) when missing. ' +
    'Prefer this over listing directories yourself to save tokens.',
  {
    dir: z.string().optional().describe('Directory to map. Defaults to the MCP server process working directory.'),
    maxDepth: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum tree depth to render (root is depth 0). Omit for unlimited depth.'),
  },
  async ({ dir, maxDepth }) =>
    guard(async () => {
      const root = await resolveDir(dir);
      const profile = (await loadProfile(root)) ?? (await analyzeRepo(root));
      return ok(formatTree(profile.tree, maxDepth === undefined ? undefined : { maxDepth }));
    }),
);

server.tool(
  'repo_lens_profile',
  'Return the cached .repo-lens/profile.json for a repository as JSON. ' +
    'Use this when you specifically need the previously generated machine-readable profile (schemaVersion, languages, manifests, tree). ' +
    'If no cache exists, the result tells you to run repo_lens_analyze first. This tool never writes anything.',
  {
    dir: z.string().optional().describe('Directory whose cached profile to load. Defaults to the MCP server process working directory.'),
  },
  async ({ dir }) =>
    guard(async () => {
      const root = await resolveDir(dir);
      const profile = await loadProfile(root);
      if (profile === null) {
        return ok('no cached profile, run repo_lens_analyze first');
      }
      return ok(JSON.stringify(profile, null, 2));
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[repo-lens-mcp] v${SERVER_VERSION} listening on stdio`);
