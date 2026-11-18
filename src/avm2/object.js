// AVM2 のオブジェクト、クラス、関数。
//
// スクリプトの値は JS の基本型（undefined / null / 真偽 / 数値 / 文字列）か、ここで定義する ASObject の派生だけ。
// プロパティは名前空間つきの名前（"名前空間のキー|名前"）をキーにした専用の Map に持つので、
// __proto__ や constructor といった名前が JS 側に影響しない。

/** 公開の名前空間のキー。 */
export const PUBLIC = 'p:';

/**
 * 名前空間（ABC の定数プールの値 { kind, uri }）のキー。同じキーなら同じ名前空間。
 * private は宣言ごとに別物なので、オブジェクトごとに番号を振る。
 */
let privateCount = 0;
export function nsKey(ns) {
  if (ns.key !== undefined) return ns.key;
  const kind = ns.kind;
  // AS3 の組み込みメソッド用の名前空間は、公開と同じに扱う（組み込みのメソッドは公開の名前でだけ定義する）。
  if (ns.uri === 'http://adobe.com/AS3/2006/builtin') ns.key = PUBLIC;
  else if (kind === 'private') ns.key = `#${++privateCount}`;
  else if (kind === 'package' || kind === 'namespace' || kind === 'any') ns.key = `p:${ns.uri}`;
  else ns.key = `${kind[0] === 's' ? 's' : kind === 'packageInternal' ? 'i' : kind === 'protected' ? 'r' : 'e'}:${ns.uri}`;
  return ns.key;
}

/** 公開の名前 name のキー。 */
export const publicKey = (name) => `${PUBLIC}|${name}`;

/** スクリプトが投げた値（throw）を JS の例外として運ぶ。 */
export class ASThrown extends Error {
  constructor(value) {
    super('ActionScript error');
    this.name = 'ASThrown';
    this.value = value;
  }
}

/** 実行の上限を超えたとき（スクリプトからは捕まえられない）。 */
export class AVM2LimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AVM2LimitError';
  }
}

export class ASObject {
  /** @param {ASClass | null} klass */
  constructor(klass) {
    this.klass = klass;
    this.values = new Map(); // キー → 値（スロットと、動的に足したプロパティ）
    klass?.vm.charge(1);
  }
}

/** 関数。スクリプトのメソッド（method + scope）か、ネイティブ（JS の関数）のどちらか。 */
export class ASFunction extends ASObject {
  /**
   * @param {object} def
   *   method: ABC の method_info        scope: 作られたときのスコープの並び
   *   native: (thisValue, args) => 値
   *   boundThis: メソッドを値として取り出したとき（メソッドクロージャ）の this
   *   owner: このメソッドを定義したクラス（super の起点）
   */
  constructor(vm, def) {
    super(vm.classes.Function ?? null);
    this.vm = vm;
    this.method = def.method ?? null;
    this.scope = def.scope ?? [];
    this.native = def.native ?? null;
    this.boundThis = def.boundThis;
    this.owner = def.owner ?? null;
    this.fnName = def.name ?? def.method?.name ?? '';
  }
}

/** 配列。要素は JS の配列に持つ。 */
export class ASArray extends ASObject {
  constructor(vm, items = []) {
    super(vm.classes.Array);
    vm.charge(items.length);
    this.items = items;
  }
}

/**
 * クラス。静的メンバーは自分の values と staticTraits、インスタンスのメンバーは instanceTraits に持つ。
 * trait: { kind: 'slot' | 'const' | 'method' | 'accessor', key, name, value?, type?, fn?, get?, set? }
 */
export class ASClass extends ASObject {
  constructor(vm, { name, superClass = null, isInterface = false, dynamic = false, final = false }) {
    super(null);
    this.vm = vm;
    this.klass = vm.classes.Class ?? null;
    this.name = name; // "flash.display::MovieClip" の形
    this.superClass = superClass;
    this.isInterface = isInterface;
    this.dynamic = dynamic; // インスタンスに動的なプロパティを足せるか
    this.final = final;
    this.interfaces = new Set(superClass?.interfaces ?? []);
    this.instanceTraits = new Map(superClass?.instanceTraits ?? []);
    this.staticTraits = new Map();
    this.constructorFn = null; // インスタンスの初期化 (iinit)
    this.allocate = superClass?.allocate ?? ((klass) => new ASObject(klass)); // インスタンスの入れ物を作る
    this.callAsFunction = null; // Foo(x) と呼ばれたときの変換（省略時は型への変換）
    // 動的な参照（obj.toString など）のための prototype。親の prototype へ連なる。
    this.prototype = new ASObject(vm.classes.Object ?? null);
    this.prototype.proto = superClass?.prototype ?? null;
    this.prototype.values.set(publicKey('constructor'), this); // obj.constructor でクラスが取れる
    this.prototype.hidden = new Set([publicKey('constructor')]); // for in には出ない
  }

  /** 短い名前（パッケージを除いたもの）。 */
  get shortName() {
    return this.name.slice(this.name.lastIndexOf(':') + 1);
  }

  /** このクラスが other と同じか、その派生か、other（インターフェース）を実装しているか。 */
  isSubclassOf(other) {
    if (other.isInterface) return this.interfaces.has(other) || this === other;
    for (let c = this; c; c = c.superClass) if (c === other) return true;
    return false;
  }
}
