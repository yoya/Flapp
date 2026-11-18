// Color、Stage、System。再生環境にかかわる組み込み。
import { toBool, toInt32, toNumber, toStr } from './convert.js';
import { AVMObject, DONT_DELETE, DONT_ENUM } from './object.js';
import { defineClass, defineMethods } from './globals.js';
import { PLAYER_VERSION } from './interp.js';

const HIDDEN = DONT_ENUM | DONT_DELETE;
const IDENTITY_CX = { rm: 256, gm: 256, bm: 256, am: 256, ra: 0, ga: 0, ba: 0, aa: 0 };
// getTransform / setTransform の名前 → 色変換の項目。a は倍率（%）、b は加算値。
const CHANNELS = [['ra', 'rm'], ['rb', 'ra'], ['ga', 'gm'], ['gb', 'ga'], ['ba', 'bm'], ['bb', 'ba'], ['aa', 'am'], ['ab', 'aa']];

/** @param {import('./interp.js').AVM1} vm  @param {{ width: number, height: number, language: string }} env  ステージの大きさ (px) と言語 */
export function installStage(vm, env = vm.environment) {
  const g = vm.global;

  // --- Color: クリップの色変換を読み書きする ---
  const colorProto = new AVMObject(vm, vm.objectProto);
  // 対象のクリップ（表示リスト上のもの）。対象が無い、または消えていれば undefined。
  const clipOf = (self) => {
    const t = self instanceof AVMObject ? self.colorTarget : undefined;
    const base = self.colorBase;
    const object = t instanceof AVMObject ? t
      : typeof t === 'string' && base ? vm.resolvePath({ target: base, scopes: [{ object: base }], thisValue: base }, t) : undefined;
    return object?.isMovieClip && !object.clip.removed ? object.clip : undefined;
  };
  defineMethods(vm, colorProto, {
    // 倍率を 0 にして、加算値を指定の色にする（アルファは変えない）
    setRGB: (_, self, [rgb]) => {
      const clip = clipOf(self);
      if (!clip) return;
      const n = toInt32(vm, rgb);
      clip.setCxform({ ...(clip.cxform ?? IDENTITY_CX), rm: 0, gm: 0, bm: 0, ra: (n >> 16) & 0xff, ga: (n >> 8) & 0xff, ba: n & 0xff });
    },
    getRGB: (_, self) => {
      const cx = clipOf(self)?.cxform ?? (clipOf(self) ? IDENTITY_CX : undefined);
      return cx && ((cx.ra << 16) | (cx.ga << 8) | cx.ba);
    },
    // 指定された項目だけを変える。倍率は 1/256 単位、加算値は整数に切り捨てて持つ。
    setTransform: (_, self, [t]) => {
      const clip = clipOf(self);
      if (!clip || !(t instanceof AVMObject)) return;
      const cx = { ...(clip.cxform ?? IDENTITY_CX) };
      for (const [name, field] of CHANNELS) {
        const v = t.get(name);
        if (v === undefined) continue;
        const n = toNumber(vm, v);
        if (!Number.isNaN(n)) cx[field] = Math.trunc(name[1] === 'a' ? (n * 256) / 100 : n);
      }
      clip.setCxform(cx);
    },
    getTransform: (_, self) => {
      const clip = clipOf(self);
      if (!clip) return undefined;
      const cx = clip.cxform ?? IDENTITY_CX;
      const out = new AVMObject(vm, vm.objectProto);
      for (const [name, field] of CHANNELS) out.define(name, name[1] === 'a' ? (cx[field] * 100) / 256 : cx[field]);
      return out;
    },
  });
  defineClass(vm, 'Color', colorProto, () => undefined, (_, [target], proto) => {
    const obj = new AVMObject(vm, proto);
    obj.colorTarget = target instanceof AVMObject ? target : target === undefined ? undefined : toStr(vm, target);
    obj.colorBase = vm.currentTarget ?? null; // 名前で指定されたときの起点
    return obj;
  });

  // --- Stage ---
  const stage = g.get('Stage'); // addListener / removeListener は globals.js が定義済み
  let scaleMode = 'showAll';
  let align = '';
  let showMenu = true;
  const MODES = ['showAll', 'noScale', 'exactFit', 'noBorder'];
  const constant = (value) => vm.native(() => value);
  stage.defineAccessor('width', constant(env.width), null, HIDDEN);
  stage.defineAccessor('height', constant(env.height), null, HIDDEN);
  // 大文字小文字を区別せず、知らない値は showAll になる
  stage.defineAccessor('scaleMode', vm.native(() => scaleMode), vm.native((_, __, [v]) => {
    scaleMode = MODES.find((m) => m.toLowerCase() === toStr(vm, v).toLowerCase()) ?? 'showAll';
  }), HIDDEN);
  // L T R B のうち含まれる文字を、この順に並べたものになる
  stage.defineAccessor('align', vm.native(() => align), vm.native((_, __, [v]) => {
    const s = toStr(vm, v).toUpperCase();
    align = [...'LTRB'].filter((c) => s.includes(c)).join('');
  }), HIDDEN);
  stage.defineAccessor('showMenu', vm.native(() => showMenu), vm.native((_, __, [v]) => { showMenu = toBool(vm, v); }), HIDDEN);

  // --- System ---
  const system = new AVMObject(vm, vm.objectProto);
  const capabilities = new AVMObject(vm, vm.objectProto);
  const values = {
    version: PLAYER_VERSION, playerType: 'StandAlone', manufacturer: 'Macromedia Macintosh', os: 'Mac OS', language: env.language,
    isDebugger: false, screenColor: 'color', pixelAspectRatio: 1, screenDPI: 72, screenResolutionX: env.width, screenResolutionY: env.height,
    hasAudio: true, hasMP3: true, hasAudioEncoder: true, hasVideoEncoder: true, hasEmbeddedVideo: true, hasStreamingAudio: true, hasStreamingVideo: true,
    hasPrinting: true, hasAccessibility: false, hasScreenBroadcast: false, hasScreenPlayback: false, avHardwareDisable: false, localFileReadDisable: false,
  };
  for (const [name, value] of Object.entries(values)) capabilities.define(name, value, HIDDEN);
  capabilities.define('serverString', Object.entries(values).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&'), HIDDEN);
  system.define('capabilities', capabilities, HIDDEN);
  system.define('useCodepage', false, HIDDEN);
  system.define('security', new AVMObject(vm, vm.objectProto), HIDDEN);
  defineMethods(vm, system, { setClipboard: () => false, showSettings: () => undefined }); // クリップボードや設定画面には触れない
  g.define('System', system, DONT_ENUM);
}
