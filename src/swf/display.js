// 表示リストを操作するタグの解釈（仕様 3 章）。
import { Reader, SWFError } from './reader.js';

/** SetBackgroundColor (9) */
export function parseSetBackgroundColor(tag) {
  return new Reader(tag.body).rgb();
}

/**
 * PlaceObject (4) / PlaceObject2 (26) / PlaceObject3 (70)。
 * 存在しない項目はプロパティ自体を持たない。
 * @param {number} [version] SWF のバージョン（クリップアクションのイベントフラグの幅が変わる）
 * @returns {{ depth: number, move: boolean, characterId?: number, matrix?: object, cxform?: object,
 *             ratio?: number, name?: string, clipDepth?: number,
 *             filters?: object[], blendMode?: string, visible?: boolean,
 *             clipActions?: Array<{ events: number, keyCode?: number, code: Uint8Array }> }}
 *   clipActions の events は CLIPEVENTFLAGS を下位バイトから並べた値（0x01 load, 0x02 enterFrame, 0x04 unload, ...）。
 */
export function parsePlaceObject(tag, version = 6) {
  const r = new Reader(tag.body, version < 6);
  if (tag.code === 4) {
    const place = { characterId: r.u16(), depth: r.u16(), move: false, matrix: r.matrix() };
    if (r.remaining > 0) place.cxform = r.cxform(false);
    return place;
  }
  if (tag.code !== 26 && tag.code !== 70) throw new SWFError(`tag ${tag.code} is not a PlaceObject`);

  const flags = r.u8();
  const flags2 = tag.code === 70 ? r.u8() : 0;
  const place = { depth: r.u16(), move: (flags & 0x01) !== 0 };
  // PlaceObject3: HasClassName、または HasImage かつ HasCharacter のときクラス名が入る。
  if ((flags2 & 0x08) || ((flags2 & 0x10) && (flags & 0x02))) place.className = r.string();
  if (flags & 0x02) place.characterId = r.u16();
  if (flags & 0x04) place.matrix = r.matrix();
  if (flags & 0x08) place.cxform = r.cxform(true);
  if (flags & 0x10) place.ratio = r.u16();
  if (flags & 0x20) place.name = r.string();
  if (flags & 0x40) place.clipDepth = r.u16();
  if (flags2 & 0x01) place.filters = filterList(r);
  if (flags2 & 0x02) place.blendMode = BLEND_MODES[r.u8()] ?? 'normal';
  if ((flags2 & 0x04) && r.remaining > 0) r.u8(); // BitmapCache。フラグだけ立って値が無いファイルがある
  if (flags2 & 0x20) place.visible = r.u8() !== 0;
  if (flags2 & 0x40) r.rgba(); // 不透明な背景色（未対応）
  if (flags & 0x80) {
    const eventFlags = () => (version >= 6 ? r.u32() : r.u16());
    r.u16(); // Reserved
    eventFlags(); // AllEventFlags
    place.clipActions = [];
    for (;;) {
      const events = eventFlags();
      if (events === 0) break;
      const size = r.u32();
      const action = { events };
      const body = new Reader(r.bytesView(size));
      if (events & 0x020000) action.keyCode = body.u8(); // KeyPress のときだけキーコードが付く
      action.code = body.bytesView(body.remaining);
      place.clipActions.push(action);
    }
  }
  return place;
}

// 番号 0 と 1 はどちらも通常の合成。
export const BLEND_MODES = [
  'normal', 'normal', 'layer', 'multiply', 'screen', 'lighten', 'darken', 'difference',
  'add', 'subtract', 'invert', 'alpha', 'erase', 'overlay', 'hardlight',
];

/** FILTERLIST（PlaceObject3 とボタンで共通）。 */
export function filterList(r) {
  const filters = [];
  const count = r.u8();
  for (let i = 0; i < count; i++) {
    const id = r.u8();
    // 影・光彩・ベベル系に共通の末尾: ぼかし量、(角度と距離)、強さ、フラグ
    const blur = () => ({ blurX: r.fixed(), blurY: r.fixed() });
    const offset = () => ({ angle: r.fixed(), distance: r.fixed() });
    const gradientColors = () => {
      const n = r.u8();
      const colors = Array.from({ length: n }, () => r.rgba());
      return colors.map((color) => ({ color, ratio: r.u8() }));
    };
    if (id === 0) {
      const f = { type: 'dropShadow', color: r.rgba(), ...blur(), ...offset(), strength: r.fixed8() };
      Object.assign(f, { inner: r.ub(1) === 1, knockout: r.ub(1) === 1, compositeSource: r.ub(1) === 1, passes: r.ub(5) });
      filters.push(f);
    } else if (id === 1) {
      filters.push({ type: 'blur', ...blur(), passes: r.ub(5) });
      r.align();
    } else if (id === 2) {
      const f = { type: 'glow', color: r.rgba(), ...blur(), strength: r.fixed8() };
      Object.assign(f, { inner: r.ub(1) === 1, knockout: r.ub(1) === 1, compositeSource: r.ub(1) === 1, passes: r.ub(5) });
      filters.push(f);
    } else if (id === 3 || id === 4 || id === 7) {
      const f = id === 3
        ? { type: 'bevel', shadowColor: r.rgba(), highlightColor: r.rgba() }
        : { type: id === 4 ? 'gradientGlow' : 'gradientBevel', colors: gradientColors() };
      Object.assign(f, blur(), offset(), { strength: r.fixed8() });
      Object.assign(f, { inner: r.ub(1) === 1, knockout: r.ub(1) === 1, compositeSource: r.ub(1) === 1, onTop: r.ub(1) === 1, passes: r.ub(4) });
      filters.push(f);
    } else if (id === 5) {
      const f = { type: 'convolution', matrixX: r.u8(), matrixY: r.u8(), divisor: r.f32(), bias: r.f32() };
      f.matrix = Array.from({ length: f.matrixX * f.matrixY }, () => r.f32());
      f.defaultColor = r.rgba();
      r.ub(6);
      Object.assign(f, { clamp: r.ub(1) === 1, preserveAlpha: r.ub(1) === 1 });
      filters.push(f);
    } else if (id === 6) {
      filters.push({ type: 'colorMatrix', matrix: Array.from({ length: 20 }, () => r.f32()) });
    } else {
      throw new SWFError(`unknown filter ${id}`);
    }
  }
  return filters;
}

/**
 * DefineButton (7) / DefineButton2 (34)。状態ごとに表示するキャラクタの一覧だけを読む（アクションは未解釈）。
 * @returns {{ id: number, records: Array<{ up: boolean, over: boolean, down: boolean, hitTest: boolean,
 *   characterId: number, depth: number, matrix: object, cxform?: object, filters?: object[], blendMode?: string }> }}
 */
export function parseDefineButton(tag) {
  if (tag.code !== 7 && tag.code !== 34) throw new SWFError(`tag ${tag.code} is not a DefineButton`);
  const r = new Reader(tag.body);
  const button = { id: r.u16(), records: [], actions: [] };
  let actionOffset = 0;
  if (tag.code === 34) {
    r.u8(); // TrackAsMenu
    actionOffset = r.u16(); // 0 ならアクションなし
  }
  for (;;) {
    const flags = r.u8();
    if (flags === 0) break;
    const rec = {
      up: (flags & 0x01) !== 0, over: (flags & 0x02) !== 0, down: (flags & 0x04) !== 0, hitTest: (flags & 0x08) !== 0,
      characterId: r.u16(), depth: r.u16(), matrix: r.matrix(),
    };
    if (tag.code === 34) {
      rec.cxform = r.cxform(true);
      if (flags & 0x10) rec.filters = filterList(r);
      if (flags & 0x20) rec.blendMode = BLEND_MODES[r.u8()] ?? 'normal';
    }
    button.records.push(rec);
  }
  // アクション。cond は状態遷移の条件（BUTTON_COND のビットの和）、key は keyPress のキーコード（無ければ 0）。
  if (tag.code === 7) {
    // DefineButton: 条件は無く、ボタンの上でマウスを離したときに実行される。
    button.actions.push({ cond: BUTTON_COND.release, key: 0, code: r.bytesView(r.remaining) });
  } else if (actionOffset !== 0) {
    for (;;) {
      const size = r.u16(); // 次の BUTTONCONDACTION までのバイト数。0 は最後
      const flags = r.u16();
      if (size !== 0 && size < 4) break; // 壊れた長さ
      const code = r.bytesView(size === 0 ? r.remaining : size - 4);
      button.actions.push({ cond: flags & 0x01ff, key: flags >> 9, code });
      if (size === 0) break;
    }
  }
  return button;
}

/** ボタンの状態遷移（BUTTONCONDACTION のフラグを、下位バイトを先にした 16 ビットで読んだ値）。 */
export const BUTTON_COND = {
  rollOver: 0x0001, // IdleToOverUp
  rollOut: 0x0002, // OverUpToIdle
  press: 0x0004, // OverUpToOverDown
  release: 0x0008, // OverDownToOverUp
  dragOut: 0x0010, // OverDownToOutDown
  dragOver: 0x0020, // OutDownToOverDown
  releaseOutside: 0x0040, // OutDownToIdle
};

/** RemoveObject (5) / RemoveObject2 (28) */
export function parseRemoveObject(tag) {
  const r = new Reader(tag.body);
  if (tag.code === 5) return { characterId: r.u16(), depth: r.u16() };
  if (tag.code === 28) return { depth: r.u16() };
  throw new SWFError(`tag ${tag.code} is not a RemoveObject`);
}
