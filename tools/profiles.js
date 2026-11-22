// 機能を絞った版（構成）の定義と、その構成のソースの木を作る処理。
//
// 構成は「外す機能のまとまり」の並び。外す機能は、境界のモジュールを src/absent/ の同じ場所のファイルに差し替える
// （差し替えは、その機能が無いことを表すだけの小さなモジュール。既定の版は差し替えを読まない）。
// 束ねる（tools/build.js）ときも、確かめる（test/profiles.test.js）ときも、ここで作った同じ木を使う。
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));

/** 外せる機能のまとまり → 差し替えるモジュール（src/ からの相対パス。src/absent/ に同じパスの差し替えがある）。 */
export const FEATURES = {
  avm2: ['avm2/vm.js', 'avm2/flash.js'], // ActionScript 3
  avm1: ['avm1/interp.js', 'avm1/clip.js', 'avm1/textfield.js', 'avm1/video.js', 'avm1/object.js', 'avm1/convert.js'], // ActionScript 1 / 2
  video: ['player/video.js', 'video/flv.js', 'video/webcodecs.js'], // 埋め込みのビデオと FLV（H.263・Screen Video・VP6・H.264）
  h264: ['video/webcodecs.js'], // ブラウザのデコーダで復号する H.264（Flash Player 9.0.115 以降）
  lzma: ['swf/lzma.js'], // LZMA 圧縮の SWF（ZWS。Flash Player 11 以降）
  flash8: ['render/filters.js', 'avm1/filters.js', 'avm1/geom.js'], // フィルタ・flash.geom・BitmapData（Flash Player 8 以降）。avm2 も外すときだけ
};

/**
 * 構成 → { without: 外す機能, note: 何に当たるか }。
 * Flash Lite と Flash Player の版ごとの構成は、その版に無い機能を外したもの（Flapp が実装している範囲で）。
 */
export const PROFILES = {
  full: { without: [], note: '全部入り（最新の Flash Player 相当）' },
  'flashplayer-8': { without: ['avm2', 'lzma', 'h264'], note: 'Flash Player 8 相当（ActionScript 1 / 2、フィルタ、BitmapData、H.263・VP6 のビデオ）' },
  'flashlite-4': { without: ['lzma'], note: 'Flash Lite 4 相当（Flash Player 10 が元。ActionScript 3 あり）' },
  'flashlite-2': { without: ['avm2', 'video', 'lzma', 'flash8'], note: 'Flash Lite 1.1 / 2.0 相当（2.0 は Flash Player 7 が元で ActionScript 1 / 2。1.1 は SWF 4 のタグと、SWF 5 相当までのスクリプト）' },
  'no-video': { without: ['video'], note: 'ビデオ抜き' },
  'no-avm2': { without: ['avm2'], note: 'ActionScript 3 抜き' },
  'no-avm2-no-video': { without: ['avm2', 'video'], note: 'ActionScript 3 とビデオ抜き' },
  'as3-only': { without: ['avm1'], note: 'ActionScript 3 だけ（ActionScript 1 / 2 抜き）' },
  'animation-only': { without: ['avm1', 'avm2', 'video'], note: 'スクリプトとビデオ抜き（アニメーションだけ）' },
};

/** 構成が差し替えるモジュールの一覧（src/ からの相対パス）。 */
export function replaced(name) {
  const profile = PROFILES[name];
  if (!profile) throw new Error(`unknown profile: ${name}`);
  if (profile.without.includes('flash8') && !profile.without.includes('avm2')) throw new Error(`profile ${name}: flash8 can be left out only together with avm2`);
  return [...new Set(profile.without.flatMap((feature) => FEATURES[feature]))];
}

/**
 * 構成 name のソースの木（src/ と web/）を、dir に作る。外す機能のモジュールは、src/absent/ のものに差し替える。
 * dir は消してから作り直す。
 */
export function materialize(name, dir) {
  const files = replaced(name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(join(repo, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(repo, 'web'), join(dir, 'web'), { recursive: true });
  for (const file of files) {
    const from = join(repo, 'src/absent', file);
    if (!existsSync(from)) throw new Error(`profile ${name}: src/absent/${file} is missing`);
    mkdirSync(dirname(join(dir, 'src', file)), { recursive: true });
    cpSync(from, join(dir, 'src', file));
  }
  rmSync(join(dir, 'src/absent'), { recursive: true, force: true });
  return dir;
}
