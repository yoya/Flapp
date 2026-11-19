// SharedObject の保存形式。
//
// プレイヤーは自分では何も保存しない。ホストが Movie.load の storage オプションで渡した
//   { load(name) → 文字列 | null, save(name, text | null) → 書けたか }
// に、SharedObject の data を JSON の文字列にして渡す（text が null なら、その名前を消す）。名前は、スクリプトが getLocal に渡した
// 名前で、SWF ごとの区別（実機は SWF の URL で分ける）はホストが付ける。
//
// 保存できるのは、undefined・null・真偽値・数値・文字列・Date・配列・普通のオブジェクトだけ。関数や、クリップ、独自のクラスの
// インスタンスなどは入れない。同じオブジェクトを 2 か所から指していれば、2 つの別のオブジェクトとして保存する（循環は undefined）。
// 保存・読み込みとも、大きさと深さに上限がある（壊れた、あるいは悪意のある文字列から、大きなデータを作らせないため）。
//
// ノード（JSON にする前の木）:
//   null、真偽値、文字列、有限の数値（-0 を除く）はそのまま
//   { $: 'u' } undefined   { $: 'n', v: 'NaN' | 'Infinity' | '-Infinity' | '-0' } 数値   { $: 'd', v: 数値のノード } Date
//   { $: 'a', v: [ノード…] } 配列   { $: 'o', v: [[名前, ノード]…] } オブジェクト（プロパティを作った順）

export const MAX_SAVED = 100 * 1024; // 保存する文字列の長さの上限（実機の、サイトごとの既定の保存量）
export const EMPTY_SHARED = '{"$":"o","v":[]}'; // 何も入っていないデータ。保存はせず、保存先から消す
const MAX_NODES = 100000;
const MAX_DEPTH = 64;
const SPECIAL_NUMBERS = new Set(['NaN', 'Infinity', '-Infinity', '-0']);

class TooBig extends Error {}

const numberNode = (n) => (Number.isFinite(n) && !Object.is(n, -0) ? n : { $: 'n', v: String(Object.is(n, -0) ? '-0' : n) });
const nodeNumber = (node) => {
  if (typeof node === 'number') return node;
  if (node?.$ === 'n' && SPECIAL_NUMBERS.has(node.v)) return node.v === '-0' ? -0 : Number(node.v);
  throw new TooBig('number');
};

/**
 * 値を文字列にする。入りきらなければ（または保存できない値だけなら）null。
 * adapter（VM ごとの値の見方）:
 *   kind(v): 'undefined' | 'null' | 'boolean' | 'number' | 'string' | 'date' | 'array' | 'object' | 'skip'（保存しない）
 *   time(date) 時刻のミリ秒   items(array) 要素の配列   entries(object) [名前, 値] を、作った順に並べた配列
 */
export function encodeShared(root, adapter) {
  const open = new Set();
  let nodes = 0;
  const walk = (v, depth) => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new TooBig('size');
    switch (adapter.kind(v)) {
      case 'undefined': return { $: 'u' };
      case 'null': return null;
      case 'boolean': case 'string': return v;
      case 'number': return numberNode(v);
      case 'date': return { $: 'd', v: numberNode(adapter.time(v)) };
      case 'array': case 'object': {
        if (open.has(v)) return { $: 'u' };
        open.add(v);
        const array = adapter.kind(v) === 'array';
        const out = array
          ? { $: 'a', v: adapter.items(v).map((x) => (adapter.kind(x) === 'skip' ? { $: 'u' } : walk(x, depth + 1))) }
          : { $: 'o', v: adapter.entries(v).filter(([, x]) => adapter.kind(x) !== 'skip').map(([k, x]) => [String(k), walk(x, depth + 1)]) };
        open.delete(v);
        return out;
      }
      default: throw new TooBig('skip');
    }
  };
  try {
    const text = JSON.stringify(walk(root, 0));
    return text.length <= MAX_SAVED ? text : null;
  } catch (e) {
    if (e instanceof TooBig) return null;
    throw e;
  }
}

/**
 * encodeShared の文字列から、値を作る。壊れていれば（あるいは上限を超えていれば）undefined。
 * builder: undefined() / date(ms) / array(要素の配列) / object([名前, 値] の配列)
 */
export function decodeShared(text, builder) {
  if (typeof text !== 'string' || text.length > MAX_SAVED) return undefined;
  let nodes = 0;
  const build = (node, depth) => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new TooBig('size');
    if (node === null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return node;
    if (typeof node !== 'object') throw new TooBig('shape');
    switch (node.$) {
      case 'u': return builder.undefined();
      case 'n': return nodeNumber(node);
      case 'd': return builder.date(nodeNumber(node.v));
      case 'a':
        if (!Array.isArray(node.v)) throw new TooBig('shape');
        return builder.array(node.v.map((x) => build(x, depth + 1)));
      case 'o':
        if (!Array.isArray(node.v)) throw new TooBig('shape');
        return builder.object(node.v.map((e) => {
          if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string') throw new TooBig('shape');
          return [e[0], build(e[1], depth + 1)];
        }));
      default: throw new TooBig('shape');
    }
  };
  try {
    return build(JSON.parse(text), 0);
  } catch (e) {
    if (e instanceof TooBig || e instanceof SyntaxError) return undefined;
    throw e;
  }
}
