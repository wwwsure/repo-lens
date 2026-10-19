#!/usr/bin/env node
/**
 * Smoke test for the repo-lens MCP server. No LLM involved.
 *
 * Starts dist/index.js over stdio, performs the MCP initialize handshake,
 * requests tools/list and verifies the three expected tools are registered,
 * then calls repo_lens_profile with a nonexistent dir to prove errors come
 * back as isError:true instead of crashing the server.
 *
 * Run after building:  node scripts/smoke.mjs   (or `pnpm smoke`)
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, '..', 'dist', 'index.js');

if (!existsSync(serverPath)) {
  console.error('smoke: dist/index.js not found — build first (pnpm build / tsc -b)');
  process.exit(1);
}

const EXPECTED_TOOLS = ['repo_lens_analyze', 'repo_lens_map', 'repo_lens_profile'];
const TIMEOUT_MS = 15000;

const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'inherit'] });

const pending = new Map();
let buffer = '';

function send(msg) {
  child.stdin.write(`${JSON.stringify(msg)}\n`);
}

function request(id, method, params) {
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    send({ jsonrpc: '2.0', id, method, params });
    void reject;
  });
}

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line === '') continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error(`smoke: FAIL — non-JSON line on stdout: ${line}`);
      child.kill();
      process.exit(1);
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const resolve = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});

const timer = setTimeout(() => {
  console.error('smoke: FAIL — timed out waiting for server');
  child.kill();
  process.exit(1);
}, TIMEOUT_MS);

try {
  const init = await request(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'repo-lens-smoke', version: '0.0.0' },
  });
  if (!init?.result?.serverInfo) {
    throw new Error(`initialize failed: ${JSON.stringify(init)}`);
  }
  console.error(`smoke: initialize ok — ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);

  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const list = await request(2, 'tools/list', {});
  const names = (list?.result?.tools ?? []).map((t) => t.name).sort();
  const expected = [...EXPECTED_TOOLS].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`tools/list mismatch: got ${JSON.stringify(names)}, expected ${JSON.stringify(expected)}`);
  }
  console.error(`smoke: tools/list ok — ${names.join(', ')}`);

  const call = await request(3, 'tools/call', {
    name: 'repo_lens_profile',
    arguments: { dir: path.join(here, '__nonexistent_dir__') },
  });
  if (call?.result?.isError !== true) {
    throw new Error(`expected isError:true for a nonexistent dir, got: ${JSON.stringify(call)}`);
  }
  console.error('smoke: error handling ok — bad dir returned isError:true, server still alive');

  clearTimeout(timer);
  console.error('smoke: PASS');
  child.kill();
  process.exit(0);
} catch (err) {
  clearTimeout(timer);
  console.error(`smoke: FAIL — ${err instanceof Error ? err.message : String(err)}`);
  child.kill();
  process.exit(1);
}
