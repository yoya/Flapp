// AVM1 のオブジェクト。
//
// スクリプトの値は JS の基本型（undefined / null / 真偽 / 数値 / 文字列）か、ここで定義する
// AVMObject のどちらかだけ。JS のホストオブジェクトをスクリプトに渡すことはない。
// プロパティは専用の Map に持つので、__proto__ や constructor といった名前が JS 側に影響しない。

export const DONT_ENUM = 1;
export const DONT_DELETE = 2;
export const READ_ONLY = 4;

/** 「自分のプロパティには無い」を表す番兵（undefined は正当な値なので使えない）。 */
export const NONE = Symbol('none');

const MAX_PROTO_DEPTH = 256; // __proto__ が循環していても止まるように
const INDEX = /^(0|[1-9]\d{0,8})$/;
export const MAX_ARRAY_LENGTH = 1 << 24; // これ以上の添字は配列の要素ではなく普通のプロパティとして扱う

export class AVMObject {
  /**
   * @param {import('./interp.js').AVM1} vm
   * @param {AVMObject | null} proto
   */
  constructor(vm, proto = null) {
    vm.charge(1);
    this.vm = vm;
    this.proto = proto;
    this.props = new Map(); // キー（SWF 6 以前は小文字化した名前）→ { name, value, flags, get, set }
  }

  key(name) {
    return this.vm.caseInsensitive ? this.vm.lower(name) : name;
  }

  // --- サブクラスが差し替える「自分のプロパティ」の読み書き ---

  /** 自分のプロパティの値。無ければ NONE。 */
  ownGet(name, receiver) {
    const slot = this.props.get(this.key(name));
    if (!slot) return NONE;
    return slot.get ? this.vm.call(slot.get, receiver, []) : slot.value;
  }

  /** 自分の既存プロパティへの代入。処理したら true。 */
  ownSet(name, value, receiver) {
    const slot = this.props.get(this.key(name));
    if (!slot) return false;
    if (slot.get || slot.set) {
      if (slot.set) this.vm.call(slot.set, receiver, [value]);
    } else if (!(slot.flags & READ_ONLY)) {
      slot.value = value;
    }
    return true;
  }

  ownHas(name) {
    return this.props.has(this.key(name));
  }

  /** 列挙できる自分のプロパティ名。新しく作られたものが先。 */
  ownKeys() {
    const keys = [];
    for (const slot of this.props.values()) if (!(slot.flags & DONT_ENUM)) keys.push(slot.name);
    keys.reverse();
    if (this.showHidden) keys.push('__proto__', 'constructor');
    return keys;
  }

  // --- 共通の操作 ---

  get(name, receiver = this) {
    if (name === '__proto__') return this.proto ?? undefined;
    let o = this;
    for (let i = 0; o && i < MAX_PROTO_DEPTH; i++, o = o.proto) {
      const v = o.ownGet(name, receiver);
      if (v !== NONE) return v;
    }
    // どこにも無ければ、__resolve(名前) があればその返り値になる。
    if (name !== '__resolve') {
      const resolve = this.get('__resolve');
      if (resolve instanceof AVMFunction) return this.vm.call(resolve, receiver, [name]);
    }
    return undefined;
  }

  /** name を持つオブジェクト（自分か __proto__ のどれか）。無ければ null。 */
  holderOf(name) {
    let o = this;
    for (let i = 0; o && i < MAX_PROTO_DEPTH; i++, o = o.proto) if (o.ownHas(name)) return o;
    return null;
  }

  has(name) {
    return name === '__proto__' || this.holderOf(name) !== null;
  }

  set(name, value, receiver = this) {
    if (name === '__proto__') {
      this.proto = value instanceof AVMObject ? value : null;
      return;
    }
    // watch されていれば、代入する値は fn(名前, 古い値, 新しい値, user) の返り値になる。削除しても watch は残る。
    const watch = this.watches?.get(this.key(name));
    if (watch) {
      const slot = this.props.get(this.key(name));
      value = this.vm.call(watch.fn, receiver, [name, slot && !slot.get ? slot.value : undefined, value, watch.user]);
    }
    if (this.ownSet(name, value, receiver)) return;
    // 継承元に setter があればそれを呼ぶ。無ければ自分に作る。
    let o = this.proto;
    for (let i = 0; o && i < MAX_PROTO_DEPTH; i++, o = o.proto) {
      const slot = o.props.get(o.key(name));
      if (slot?.get || slot?.set) {
        if (slot.set) this.vm.call(slot.set, receiver, [value]);
        return;
      }
    }
    this.define(name, value);
  }

  /** 自分のプロパティを作る（既にあれば置き換える）。 */
  define(name, value, flags = 0) {
    const key = this.key(name);
    if (!this.props.has(key)) this.vm.charge(1);
    this.props.set(key, { name, value, flags });
  }

  /** getter / setter つきのプロパティを作る (Object.addProperty)。 */
  defineAccessor(name, get, set, flags = 0) {
    const key = this.key(name);
    if (!this.props.has(key)) this.vm.charge(1);
    this.props.set(key, { name, value: undefined, flags, get, set });
  }

  delete(name) {
    const key = this.key(name);
    const slot = this.props.get(key);
    if (!slot || slot.flags & DONT_DELETE) return false;
    this.props.delete(key);
    return true;
  }

  /**
   * for..in で列挙される名前。継承元の深い方から順に並び、自分のものが最後。
   * 同じ名前が複数の階層にあれば、いちばん手前（自分に近い側）の位置に 1 回だけ出る。
   */
  enumerate() {
    const chain = [];
    for (let o = this, i = 0; o && i < MAX_PROTO_DEPTH; i++, o = o.proto) chain.push(o);
    const seen = new Set(); // 手前の階層に既にある名前（列挙できないものも、奥の同名を隠す）
    const levels = chain.map((o) => {
      const names = o.ownKeys().filter((name) => !seen.has(this.key(name)));
      for (const name of names) seen.add(this.key(name));
      for (const key of o.props.keys()) seen.add(key);
      return names;
    });
    return levels.reverse().flat();
  }

  /** プロパティの属性を変える (ASSetPropFlags)。names が null なら全プロパティ。 */
  setFlags(names, set, clear) {
    // 実機のオブジェクトは隠し属性の __proto__ と constructor を自分のプロパティとして持ち、
    // 全プロパティの「列挙しない」を外すとそれらも列挙される。
    if (!names && clear & DONT_ENUM) this.showHidden = true;
    for (const [key, slot] of this.props) {
      if (names && !names.includes(key)) continue;
      slot.flags = (slot.flags & ~clear) | set;
    }
  }
}

/** 関数。ネイティブ（JS で実装）かスクリプト（バイトコード）のどちらか。 */
export class AVMFunction extends AVMObject {
  /**
   * @param {object} def
   *   native: (vm, thisValue, args) => 値            関数として呼ばれたとき
   *   construct: (vm, args, proto) => AVMObject      new で呼ばれたときに作るオブジェクト（省略時は普通のオブジェクト）
   *   script: { code, start, end, params, ... }      スクリプト関数の本体（interp.js が使う）
   */
  constructor(vm, def) {
    super(vm, vm.functionProto);
    this.native = def.native ?? null;
    this.construct = def.construct ?? null;
    this.script = def.script ?? null;
  }
}

/** 配列。添字のプロパティは JS の配列に持つ。 */
export class AVMArray extends AVMObject {
  constructor(vm, items = []) {
    super(vm, vm.arrayProto);
    vm.charge(items.length);
    this.items = items;
    this.order = null; // 添字が作られた順（末尾への追加以外があったときだけ持つ）
  }

  // 添字 i に新しく要素を作ることを記録する。末尾への追加だけなら記録は不要（添字の昇順 = 作られた順）。
  #created(i) {
    if (!this.order && i !== this.items.length) this.order = Object.keys(this.items).map(Number);
    this.order?.push(i);
  }

  ownGet(name, receiver) {
    if (name === 'length') return this.items.length;
    if (INDEX.test(name)) {
      const i = Number(name);
      if (i < this.items.length) return i in this.items ? this.items[i] : NONE;
    }
    return super.ownGet(name, receiver);
  }

  ownSet(name, value, receiver) {
    if (name === 'length') {
      this.setLength(value);
      return true;
    }
    if (INDEX.test(name) && Number(name) < MAX_ARRAY_LENGTH) {
      const i = Number(name);
      if (!(i in this.items)) {
        this.vm.charge(1);
        this.#created(i);
      }
      this.items[i] = value;
      return true;
    }
    return super.ownSet(name, value, receiver);
  }

  ownHas(name) {
    if (name === 'length') return true;
    if (INDEX.test(name) && Number(name) < this.items.length) return Number(name) in this.items;
    return super.ownHas(name);
  }

  setLength(value) {
    const n = Math.floor(Number(value));
    if (n >= 0 && n < MAX_ARRAY_LENGTH) this.items.length = n;
    if (this.order) this.order = this.order.filter((i) => i < n);
  }

  /** push / splice など、JS の配列操作で中身をまとめて変えた後に呼ぶ。 */
  reordered() {
    this.order = null;
  }

  delete(name) {
    if (INDEX.test(name) && Number(name) < this.items.length) {
      delete this.items[Number(name)];
      if (this.order) this.order = this.order.filter((i) => i !== Number(name));
      return true;
    }
    return super.delete(name);
  }

  ownKeys() {
    // 添字も他のプロパティと同じく、新しく作られたものが先。
    const keys = [];
    if (this.order) for (let k = this.order.length - 1; k >= 0; k--) keys.push(String(this.order[k]));
    else for (let i = this.items.length - 1; i >= 0; i--) if (i in this.items) keys.push(String(i));
    return [...super.ownKeys(), ...keys];
  }
}
