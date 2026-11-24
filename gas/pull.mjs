#!/usr/bin/env node
// Pull the LIVE code + manifest of Apps Script projects into this repo.
//
//   node gas/pull.mjs            → all projects
//   node gas/pull.mjs admin      → only the given keys
//
// Needs a local `clasp login` (see gas/README.md). For every project:
//   - appsscript.json → gas/manifests/<key>.json (required before the
//     project can be auto-deployed)
//   - code files are matched to the repo files and OVERWRITE them when the
//     live version differs, so the repo starts from what is actually live
//   - files that only exist online are saved into the project's folder and
//     added to gas/projects.json
// Nothing is deployed. Review `git diff` afterwards and commit.
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT, CODE_EXT, loadConfig, saveConfig, selectProjects,
  manifestRel, projectFiles, makeWorkdir, clasp, normalize
} from './lib.mjs';

const keys = process.argv.slice(2);
const config = loadConfig();
const projects = selectProjects(config, keys);
let failed = 0;
let configChanged = false;

const baseName = f => path.basename(f).replace(CODE_EXT, '').toLowerCase();

for (const p of projects) {
  console.log('\n━━ ' + p.key + ' — ' + p.name);
  const work = makeWorkdir(p);
  const res = clasp(['pull'], work);
  if (res.status !== 0) {
    console.log('  ✗ clasp pull failed:\n' + res.output.replace(/^/gm, '    '));
    failed++;
    continue;
  }

  // ── Manifest ──────────────────────────────────────────────
  const manifestSrc = path.join(work, 'appsscript.json');
  if (fs.existsSync(manifestSrc)) {
    const manifest = JSON.parse(fs.readFileSync(manifestSrc, 'utf8'));
    const dest = path.join(REPO_ROOT, manifestRel(p));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(manifest, null, 2) + '\n');
    console.log('  ✓ manifest → ' + manifestRel(p) + (manifest.webapp ? '' : '   ⚠ no "webapp" section — not deployable as a web app'));
  } else {
    console.log('  ⚠ no appsscript.json returned');
  }

  // ── Code files ────────────────────────────────────────────
  const online = fs.readdirSync(work).filter(f => CODE_EXT.test(f));
  const repo = projectFiles(p);
  const pairs = [];
  const onlineLeft = new Set(online);
  const repoLeft = new Set(repo);

  if (repo.length === 1 && online.length === 1) {
    pairs.push([online[0], repo[0]]);
    onlineLeft.clear(); repoLeft.clear();
  } else {
    for (const o of online) {
      const match = repo.find(r => repoLeft.has(r) && baseName(r) === baseName(o));
      if (match) { pairs.push([o, match]); onlineLeft.delete(o); repoLeft.delete(match); }
    }
  }

  for (const [o, r] of pairs) {
    const live = normalize(fs.readFileSync(path.join(work, o), 'utf8'));
    const abs = path.join(REPO_ROOT, r);
    const local = fs.existsSync(abs) ? normalize(fs.readFileSync(abs, 'utf8')) : null;
    if (local === live) {
      console.log('  = ' + r + ' (same as live)');
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, live);
      console.log('  ↻ ' + r + ' UPDATED from live "' + o + '" — review git diff');
    }
  }

  for (const o of onlineLeft) {
    const rel = p.dir + '/' + o;
    const abs = path.join(REPO_ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, normalize(fs.readFileSync(path.join(work, o), 'utf8')));
    if (p.files && p.files.length && !p.files.includes(o)) {
      p.files.push(o);
      configChanged = true;
    }
    console.log('  + ' + rel + ' (only online — saved and added to the project)');
  }

  for (const r of repoLeft) {
    console.log('  ⚠ ' + r + ' is NOT in the live project — it would be added on the next deploy');
  }
}

if (configChanged) {
  saveConfig(config);
  console.log('\ngas/projects.json updated with files that only existed online.');
}
console.log('\nDone. Review the changes with `git diff` and commit them.');
process.exit(failed ? 1 : 0);
