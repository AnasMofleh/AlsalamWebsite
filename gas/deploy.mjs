#!/usr/bin/env node
// Push + redeploy Apps Script projects (used by .github/workflows/deploy-gas.yml).
//
//   node gas/deploy.mjs --since <sha> [--until <sha>]  → projects whose files changed
//   node gas/deploy.mjs --only admin,swish-reader       → given keys
//   node gas/deploy.mjs --all                           → every project
//   add --dry-run to only print what would happen
//
// Each project is pushed from a temp folder that contains exactly its files
// + its manifest, then `clasp deploy --deploymentId` creates a new version
// on the EXISTING deployment, so the /exec URL never changes.
// A project is skipped (not failed) until its manifest has been pulled with
// gas/pull.mjs — pushing a manifest without the "webapp" section would
// break the web app.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT, loadConfig, selectProjects, manifestRel, projectFiles, makeWorkdir, clasp
} from './lib.mjs';

const argv = process.argv.slice(2);
const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const dryRun = argv.includes('--dry-run');
const config = loadConfig();

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

// ── Which projects? ─────────────────────────────────────────
let projects;
const since = arg('--since');
if (argv.includes('--all')) {
  projects = config.projects;
} else if (arg('--only')) {
  projects = selectProjects(config, arg('--only').split(',').map(s => s.trim()).filter(Boolean));
} else if (since) {
  const until = arg('--until') || 'HEAD';
  if (/^0+$/.test(since)) {
    console.log('No previous commit to compare with — nothing to deploy.');
    process.exit(0);
  }
  const changed = git(['diff', '--name-only', since, until]).split('\n').filter(Boolean);
  projects = config.projects.filter(p => {
    const files = projectFiles(p);
    return changed.some(c =>
      c === manifestRel(p) ||
      files.includes(c) ||
      (!(p.files && p.files.length) && c.startsWith(p.dir + '/') && !c.slice(p.dir.length + 1).includes('/')));
  });
  console.log('Changed files: ' + (changed.length ? '\n  ' + changed.join('\n  ') : '(none)'));
} else {
  console.error('Usage: node gas/deploy.mjs (--since <sha> [--until <sha>] | --only <keys> | --all) [--dry-run]');
  process.exit(2);
}

if (!projects.length) {
  console.log('No Apps Script project changed — nothing to deploy.');
  process.exit(0);
}

// ── Deploy ──────────────────────────────────────────────────
let description = 'auto-deploy';
try {
  description = git(['log', '-1', '--format=%h %s']).slice(0, 90);
} catch (e) { /* not a git checkout */ }

const summary = [];
let failed = 0;

for (const p of projects) {
  const files = projectFiles(p);
  const manifestPath = path.join(REPO_ROOT, manifestRel(p));
  let skip = '';
  if (!fs.existsSync(manifestPath)) {
    skip = 'no manifest yet — run `node gas/pull.mjs ' + p.key + '` once';
  } else if (!JSON.parse(fs.readFileSync(manifestPath, 'utf8')).webapp) {
    skip = 'manifest has no "webapp" section';
  } else if (!files.length) {
    skip = 'no code files in ' + p.dir;
  } else {
    const missing = files.filter(f => !fs.existsSync(path.join(REPO_ROOT, f)));
    if (missing.length) skip = 'missing file(s): ' + missing.join(', ');
  }

  console.log('\n━━ ' + p.key + ' — ' + p.name);
  if (skip) {
    console.log('  ↷ skipped: ' + skip);
    summary.push('| ' + p.key + ' | ↷ skipped | ' + skip + ' |');
    continue;
  }
  console.log('  files: ' + files.join(', '));
  if (dryRun) {
    summary.push('| ' + p.key + ' | dry run | ' + files.join(', ') + ' |');
    continue;
  }

  const work = makeWorkdir(p);
  fs.copyFileSync(manifestPath, path.join(work, 'appsscript.json'));
  for (const f of files) fs.copyFileSync(path.join(REPO_ROOT, f), path.join(work, path.basename(f)));

  const push = clasp(['push', '--force'], work);
  console.log(push.output.replace(/^/gm, '  '));
  if (push.status !== 0) {
    failed++;
    summary.push('| ' + p.key + ' | ✗ push failed | see log |');
    continue;
  }

  const dep = clasp(['deploy', '--deploymentId', p.deploymentId, '--description', description], work);
  console.log(dep.output.replace(/^/gm, '  '));
  if (dep.status !== 0) {
    failed++;
    summary.push('| ' + p.key + ' | ✗ deploy failed | see log |');
    continue;
  }
  const version = (dep.output.match(/@(\d+)/) || [])[1];
  summary.push('| ' + p.key + ' | ✓ deployed | ' + (version ? 'version ' + version : 'new version') + ' |');
}

const table = '| Project | Result | Details |\n|---|---|---|\n' + summary.join('\n') + '\n';
console.log('\n' + table);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Apps Script deploy\n\n' + table);
}
process.exit(failed ? 1 : 0);
