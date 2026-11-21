// 機能を絞った版（tools/profiles.js の構成）ごとに、web/flapp.js を 1 つのファイルに束ねて最小化する。
//   node tools/build.js [構成 ...]      構成を省くと全部。出力は dist/flapp.<構成>.min.js
// 束ねるのには bun（https://bun.sh）を使う。再生するだけなら不要（web/flapp.js は、束ねなくても動く）。
// 使い方は、束ねない版と同じ: <script type="module" src="dist/flapp.flashlite-2.min.js"></script> と <flapp-player>。
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { PROFILES, materialize } from './profiles.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PROFILES);
for (const name of names) if (!PROFILES[name]) { console.error(`unknown profile: ${name}\nprofiles: ${Object.keys(PROFILES).join(', ')}`); process.exit(2); }

try {
  execFileSync('bun', ['--version'], { stdio: 'pipe' });
} catch {
  console.error('bun が見つかりません。束ねるには bun（https://bun.sh）が要ります。');
  process.exit(1);
}

const out = join(repo, 'dist');
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'flapp-build-'));
const kb = (n) => `${(n / 1024).toFixed(0)} KB`.padStart(8);
try {
  console.log(`${'構成'.padEnd(20)}${'大きさ'.padStart(6)}${'gzip'.padStart(10)}  内容`);
  for (const name of names) {
    const { without, note } = PROFILES[name];
    const dir = materialize(name, join(work, name));
    const file = join(out, `flapp.${name}.min.js`);
    // 最小化はコメントを消すので、著作権と、VP6 の復号（LGPL）を含むことは、先頭に書いておく。
    const lgpl = without.includes('video') ? '' : ' Includes a VP6 decoder ported from FFmpeg (src/video/vp6.js), LGPL-2.1-or-later.';
    const banner = `/* Flapp ${version} (${name}${without.length ? `: without ${without.join(', ')}` : ''}). Copyright (c) 2026 Yoshihiro Yamazaki.${lgpl} */`;
    execFileSync('bun', ['build', join(dir, 'web/flapp.js'), '--minify', '--target=browser', '--format=esm', `--banner=${banner}`, `--outfile=${file}`], { stdio: 'pipe' });
    const bytes = readFileSync(file);
    console.log(`${name.padEnd(20)}${kb(bytes.length)}${kb(gzipSync(bytes, { level: 9 }).length)}  ${note}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
