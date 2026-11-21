// 機能を絞った版（tools/profiles.js の構成）ごとに、web/flapp.js を 1 つのファイルに束ねて最小化する。
//   node tools/build.js [構成 ...]      構成を省くと全部。出力は dist/flapp.<構成>.min.js
// 束ねるのには bun（https://bun.sh）を使う。再生するだけなら不要（web/flapp.js は、束ねなくても動く）。
// 使い方は、束ねない版と同じ: <script type="module" src="dist/flapp.flashlite-2.min.js"></script> と <flapp-player>。
//
// VP6 の復号器（src/video/vp6.js）は LGPL なので、束には入れない。ビデオを含む構成のときは、dist/flapp-vp6.js として
// 最小化せずにそのまま置き（配るファイルがそのままソースになる）、LGPL の本文も dist/ に置く。束は、VP6 のビデオを映すときにだけ
// それを読み込む（web/flapp.js の VP6_URL）。ビデオを含まない構成の束は、VP6 を読みに行かない。
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// web/flapp.js の、VP6 の復号器の場所の行。束では、束の横の flapp-vp6.js（ビデオを含まない構成では null）に書き換える。
const VP6_LINE = "const VP6_URL = new URL('../src/video/vp6.js', import.meta.url).href;";
let withVP6 = false; // ビデオを含む構成を作ったか（flapp-vp6.js を置く）
try {
  console.log(`${'構成'.padEnd(20)}${'大きさ'.padStart(6)}${'gzip'.padStart(10)}  内容`);
  for (const name of names) {
    const { without, note } = PROFILES[name];
    const dir = materialize(name, join(work, name));
    const video = !without.includes('video');
    withVP6 ||= video;
    const entry = join(dir, 'web/flapp.js');
    const source = readFileSync(entry, 'utf8');
    if (!source.includes(VP6_LINE)) throw new Error(`web/flapp.js: the line of VP6_URL is not found: ${VP6_LINE}`);
    writeFileSync(entry, source.replace(VP6_LINE, `const VP6_URL = ${video ? "new URL('flapp-vp6.js', import.meta.url).href" : 'null'};`));
    const file = join(out, `flapp.${name}.min.js`);
    // 最小化はコメントを消すので、著作権と、VP6 の復号器を別のファイルから読むことは、先頭に書いておく。
    const vp6 = video ? ' VP6 video is decoded by flapp-vp6.js, a separate file under LGPL-2.1-or-later (not included in this file).' : '';
    const banner = `/* Flapp ${version} (${name}${without.length ? `: without ${without.join(', ')}` : ''}). Copyright (c) 2026 Yoshihiro Yamazaki.${vp6} */`;
    execFileSync('bun', ['build', join(dir, 'web/flapp.js'), '--minify', '--target=browser', '--format=esm', `--banner=${banner}`, `--outfile=${file}`], { stdio: 'pipe' });
    const bytes = readFileSync(file);
    console.log(`${name.padEnd(20)}${kb(bytes.length)}${kb(gzipSync(bytes, { level: 9 }).length)}  ${note}`);
  }
  if (withVP6) {
    copyFileSync(join(repo, 'src/video/vp6.js'), join(out, 'flapp-vp6.js'));
    copyFileSync(join(repo, 'LICENSES/LGPL-2.1-or-later.txt'), join(out, 'LGPL-2.1-or-later.txt'));
    const bytes = readFileSync(join(out, 'flapp-vp6.js'));
    console.log(`${'flapp-vp6.js'.padEnd(20)}${kb(bytes.length)}${kb(gzipSync(bytes, { level: 9 }).length)}  VP6 の復号器（LGPL 2.1 以降。VP6 のビデオを映すときにだけ読み込む）`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
