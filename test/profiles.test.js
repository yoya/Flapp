// 機能を絞った版（tools/profiles.js の構成）。構成ごとのソースの木を作って読み込み、テスト用の SWF を全部動かして確かめる。
//   - どの SWF でも落ちない（入力を与えても）。外した機能が要る SWF は、警告を残して、その機能なしで再生する。
//   - 外した機能を使わない SWF の trace は、全部入りの版と同じ。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Movie as RepoMovie } from '../src/player/movie.js';
import { PROFILES, materialize, replaced } from '../tools/profiles.js';
import { VP6Decoder } from '../src/video/vp6.js';

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));
const files = readdirSync(fixtures).filter((f) => f.endsWith('.swf')).sort();
const work = mkdtempSync(join(tmpdir(), 'flapp-profiles-'));
after(() => rmSync(work, { recursive: true, force: true }));

// 構成 name の木から Movie を読み込む（木ごとに、別のモジュールとして読まれる）。
const movieOf = async (name) => (await import(pathToFileURL(join(materialize(name, join(work, name)), 'src/player/movie.js')))).Movie;

// SWF を 40 フレーム進め、入力を一通り与える。返すのは { traces, warnings } か { error }。
async function play(Movie, file, options = {}) {
  let time = 0;
  try {
    const movie = await Movie.load(readFileSync(join(fixtures, file)), { now: () => time, random: () => 0.5, encoding: file.includes('-sjis') ? 'shift_jis' : undefined, vp6: () => VP6Decoder, ...options });
    for (let i = 0; i < 40; i++) {
      time += 1000 / (movie.frameRate || 12);
      movie.advance();
      await new Promise((resolve) => setImmediate(resolve));
    }
    const w = movie.frameSize.xmax - movie.frameSize.xmin, h = movie.frameSize.ymax - movie.frameSize.ymin;
    for (const [x, y] of [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]]) {
      movie.mouseMove(Math.round(w * x), Math.round(h * y));
      movie.mouseDown();
      movie.advance();
      movie.mouseUp();
      movie.advance();
    }
    movie.keyDown(65, 97, {});
    movie.textInput('a');
    movie.keyUp(65);
    movie.mouseWheel(3);
    movie.mouseLeave();
    movie.advance();
    return { traces: movie.traces, warnings: movie.warnings };
  } catch (e) {
    return { error: e.name };
  }
}

const base = new Map();
for (const file of files) base.set(file, await play(RepoMovie, file));

// 外した機能が、その SWF の結果を変えてよいか。
const AFFECTS = {
  avm2: (file) => file.startsWith('as3'),
  avm1: (file) => !file.startsWith('as3'),
  video: (file) => file.startsWith('video-'), // 埋め込みのビデオは、警告が増える（FLV は、このテストでは渡していないので変わらない）
  h264: () => false,
  lzma: (file) => file === 'zws-hello.swf',
  flash8: (file) => ['as-bitmapops2.swf', 'as-filters.swf', 'as-geombitmap.swf', 'asx-drawtext.swf'].includes(file), // flash.geom・BitmapData・フィルタを使うもの
};

const done = new Map(); // 差し替えの組が同じ構成は、1 回だけ確かめる
for (const [name, profile] of Object.entries(PROFILES)) {
  const key = replaced(name).sort().join(',');
  if (done.has(key)) {
    test(`${name}: モジュールは ${done.get(key)} と同じ`, () => assert.deepEqual(replaced(name).sort(), replaced(done.get(key)).sort()));
    continue;
  }
  done.set(key, name);
  test(`${name}: 全部の SWF が落ちずに動き、外した機能を使わない SWF は全部入りと同じ`, async () => {
    const Movie = await movieOf(name);
    for (const file of files) {
      const result = await play(Movie, file);
      const expected = base.get(file);
      const affected = profile.without.some((feature) => AFFECTS[feature](file));
      if (file === 'zws-hello.swf' && profile.without.includes('lzma')) {
        assert.equal(result.error, 'SWFError', file); // 読めないことを、SWF の誤りとして伝える
      } else if (affected) {
        assert.equal(result.error, undefined, `${file} must not throw`);
      } else {
        assert.deepEqual(result, expected, file);
      }
    }
  });
}

test('ActionScript 3 を外した版: AS3 の SWF は、警告を残してスクリプトなしで再生する', async () => {
  const Movie = await movieOf('no-avm2');
  const result = await play(Movie, 'as3-triangles.swf');
  assert.deepEqual(result.traces, []);
  assert.ok(result.warnings.some((w) => /ActionScript 3 is not included/.test(w)), result.warnings.join('\n'));
  const as2 = await play(Movie, 'as-math.swf'); // ActionScript 1 / 2 は、そのまま動く
  assert.deepEqual(as2, base.get('as-math.swf'));
});

test('ActionScript 1 / 2 を外した版: スクリプトのある SWF は、警告を 1 回だけ残して再生する', async () => {
  const Movie = await movieOf('as3-only');
  const result = await play(Movie, 'as-math.swf');
  assert.deepEqual(result.traces, []);
  assert.equal(result.warnings.filter((w) => /ActionScript 1 \/ 2 is not included/.test(w)).length, 1);
  assert.deepEqual(await play(Movie, 'as3-triangles.swf'), base.get('as3-triangles.swf'));
});

test('ビデオを外した版: 埋め込みのビデオは映さず警告を残し、FLV は見つからない扱いになる', async () => {
  const Movie = await movieOf('no-video');
  const embedded = await play(Movie, 'video-h263.swf');
  assert.ok(embedded.warnings.some((w) => /codec h263 is not supported/.test(w)), embedded.warnings.join('\n'));
  // NetStream.play: 全部入りは再生を始め、ビデオを外した版は StreamNotFound を伝える。
  const media = () => readFileSync(fileURLToPath(new URL('../tools/assets/video-h263.flv', import.meta.url)));
  const full = await play(RepoMovie, 'as-netstream.swf', { media });
  const lite = await play(Movie, 'as-netstream.swf', { media });
  assert.ok(full.traces.some((t) => /NetStream\.Play\.Start/.test(t)), full.traces.join('\n'));
  assert.ok(!lite.traces.some((t) => /NetStream\.Play\.Start/.test(t)));
  assert.ok(lite.traces.some((t) => /StreamNotFound/.test(t)), lite.traces.join('\n'));
});

test('Flash Lite 2 の版: flash.geom・BitmapData・フィルタのクラスは無く、ほかの ActionScript 2 は動く', async () => {
  const Movie = await movieOf('flashlite-2');
  const result = await play(Movie, 'as-geombitmap.swf');
  assert.equal(result.error, undefined);
  assert.notDeepEqual(result.traces, base.get('as-geombitmap.swf').traces);
  assert.deepEqual(await play(Movie, 'as-xml.swf'), base.get('as-xml.swf'));
});

test('構成の決まり: flash8 は avm2 と一緒にだけ外せる。差し替えは全部 src/absent にある', () => {
  PROFILES.bad = { without: ['flash8'], note: '' };
  assert.throws(() => replaced('bad'), /only together with avm2/);
  delete PROFILES.bad;
  assert.throws(() => replaced('no-such'), /unknown profile/);
  for (const name of Object.keys(PROFILES)) for (const file of replaced(name)) readFileSync(fileURLToPath(new URL(`../src/absent/${file}`, import.meta.url)));
});
