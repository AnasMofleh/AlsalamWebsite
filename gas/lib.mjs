// Shared helpers for gas/pull.mjs and gas/deploy.mjs.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GAS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(GAS_DIR, '..');
export const PROJECTS_FILE = path.join(GAS_DIR, 'projects.json');
export const CODE_EXT = /\.(gs|js|html)$/i;

export function loadConfig() {
  return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
}

export function saveConfig(config) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(config, null, 2) + '\n');
}

export function selectProjects(config, keys) {
  if (!keys.length || keys.includes('all')) return config.projects;
  const unknown = keys.filter(k => !config.projects.some(p => p.key === k));
  if (unknown.length) throw new Error('Unknown project key(s): ' + unknown.join(', '));
  return config.projects.filter(p => keys.includes(p.key));
}

/** Manifest path relative to the repo root (forward slashes). */
export function manifestRel(p) {
  return 'gas/manifests/' + p.key + '.json';
}

/** Repo-relative paths (forward slashes) of the code files that belong to a project. */
export function projectFiles(p) {
  if (p.files && p.files.length) return p.files.map(f => p.dir + '/' + f);
  const abs = path.join(REPO_ROOT, p.dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs)
    .filter(f => CODE_EXT.test(f) && fs.statSync(path.join(abs, f)).isFile())
    .sort()
    .map(f => p.dir + '/' + f);
}

/** Temp folder with a .clasp.json for the project (clasp runs in it). */
export function makeWorkdir(p) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-' + p.key + '-'));
  fs.writeFileSync(path.join(dir, '.clasp.json'),
    JSON.stringify({ scriptId: p.scriptId, fileExtension: 'gs' }, null, 2));
  return dir;
}

/** Runs clasp; returns { status, output }. */
export function clasp(args, cwd) {
  const bin = process.env.CLASP_BIN || 'clasp';
  const isWin = process.platform === 'win32';
  // On Windows clasp is a .cmd shim and needs a shell; quote args with spaces.
  const finalArgs = isWin
    ? args.map(a => (/[\s"&|<>^]/.test(a) ? '"' + String(a).replace(/"/g, '\'') + '"' : a))
    : args;
  const res = spawnSync(bin, finalArgs, {
    cwd,
    encoding: 'utf8',
    shell: isWin
  });
  const output = ((res.stdout || '') + (res.stderr || '')).trim();
  return { status: res.status === null ? 1 : res.status, output: output || String(res.error || '') };
}

export function normalize(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
}
