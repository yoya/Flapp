// 表示リストを操作するタグの解釈（仕様 3 章）。
import { Reader, SWFError } from './reader.js';

/** SetBackgroundColor (9) */
export function parseSetBackgroundColor(tag) {
  return new Reader(tag.body).rgb();
}

/**
 * PlaceObject (4) / PlaceObject2 (26) / PlaceObject3 (70)。
 * 存在しない項目はプロパティ自体を持たない。フィルタ・ブレンド・クリップアクション等は未解釈。
 * @returns {{ depth: number, move: boolean, characterId?: number, matrix?: object, cxform?: object,
 *             ratio?: number, name?: string, clipDepth?: number }}
 */
export function parsePlaceObject(tag) {
  const r = new Reader(tag.body);
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
  return place;
}

/** RemoveObject (5) / RemoveObject2 (28) */
export function parseRemoveObject(tag) {
  const r = new Reader(tag.body);
  if (tag.code === 5) return { characterId: r.u16(), depth: r.u16() };
  if (tag.code === 28) return { depth: r.u16() };
  throw new SWFError(`tag ${tag.code} is not a RemoveObject`);
}
