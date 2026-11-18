// AVM2（ActionScript 3 の実行系）。ABC の読み込み、クラスの組み立て、プロパティの読み書き、型変換。
// 命令の実行は interp.js、組み込みクラスは toplevel.js と flash.js。
//
// SWF は信用できない入力として扱う。命令は 1 つずつ解釈して実行し（eval やコード生成はしない）、
// 命令数・割り当て数・呼び出しの深さに上限を設ける。
import { parseABC } from './abc.js';
import { execute } from './interp.js';
import { ASArray, ASClass, ASFunction, ASObject, ASThrown, AVM2LimitError, PUBLIC, nsKey, publicKey } from './object.js';
import { installToplevel } from './toplevel.js';

const EMPTY = Object.freeze([]);

export class AVM2 {
  /**
   * @param {object} [options]
   *   trace: (text) => void   trace() の出力先
   *   now: () => number       getTimer() 用の経過ミリ秒
   *   random: () => number    0 以上 1 未満の乱数
   *   maxSteps / maxAllocations: 1 回のスクリプト実行で許す命令数・割り当て数
   *   maxDepth: 関数呼び出しの深さの上限
   */
  constructor({ trace = () => {}, now = () => 0, random = Math.random, maxSteps = 2e7, maxAllocations = 4e6, maxDepth = 512 } = {}) {
    this.trace = trace;
    this.now = now;
    this.random = random;
    this.maxSteps = maxSteps;
    this.maxAllocations = maxAllocations;
    this.maxDepth = maxDepth;
    this.steps = Infinity;
    this.allocations = Infinity;
    this.depth = 0;
    this.running = false;
    this.disabled = false; // 上限を超えたら、以後のスクリプトを止める
    this.classes = {}; // 組み込みクラス（内部の短い名前 → ASClass）
    this.definitions = new Map(); // 大域の定義: キー → 値を持つ大域オブジェクト（スクリプトなら初期化を伴う）
    this.nativeGlobal = null;
    installToplevel(this);
  }

  /** 割り当ての計上。上限を超えたら止める（スクリプトからは捕まえられない）。 */
  /** ネイティブの処理が、命令 n 個ぶんの時間を使ったことにする。 */
  step(n) {
    this.steps -= n;
    if (this.steps < 0) throw new AVM2LimitError('script runs too long');
  }

  charge(n) {
    this.allocations -= n;
    if (this.allocations < 0) throw new AVM2LimitError('script allocates too much');
  }

  // --- エラー ---

  /** 組み込みのエラー（TypeError など）を作って投げる。 */
  throwError(className, id, message) {
    const klass = this.classes[className] ?? this.classes.Error;
    const error = this.construct(klass, [`Error #${id}: ${message}`, id]);
    throw new ASThrown(error);
  }

  // --- 読み込み ---

  /**
   * ABC を読み込む。大域の定義（クラスや関数）を登録し、lazy でなければ最後のスクリプトを実行する。
   * lazy のとき、各スクリプトは定義が最初に参照されたときに実行される。
   */
  loadABC(bytes, { lazy = true } = {}) {
    const abc = parseABC(bytes);
    for (const method of abc.methods) method.abc = abc;
    const scripts = abc.scripts.map((info) => ({ abc, info, global: null, state: 'new' }));
    for (const script of scripts) {
      for (const trait of script.info.traits) {
        const key = this.#traitKey(abc, trait);
        if (key && !this.definitions.has(key)) this.definitions.set(key, script);
      }
    }
    if (!lazy && scripts.length) this.#initScript(scripts[scripts.length - 1]);
    return abc;
  }

  // 定義を持つスクリプトを（まだなら）実行して、その大域オブジェクトを返す。
  #initScript(script) {
    if (script.state === 'new') {
      script.state = 'running';
      const { abc, info } = script;
      const shape = this.#shape(abc, info.traits, 'global', null);
      script.global = new ASObject(shape);
      this.#initSlots(script.global, shape.instanceTraits);
      const scope = [{ object: script.global }];
      for (const trait of shape.instanceTraits.values()) if (trait.functionMethod) script.global.values.set(trait.key, new ASFunction(this, { method: trait.functionMethod, scope }));
      this.call(new ASFunction(this, { method: abc.methods[info.init], scope: EMPTY }), script.global, []);
      script.state = 'done';
    }
    return script.global;
  }

  /** 大域の定義を持つオブジェクト（スクリプトの大域オブジェクトか、組み込みの置き場）を返す。無ければ undefined。 */
  globalHolder(keys) {
    for (const key of keys) {
      const holder = this.definitions.get(key);
      if (holder) return holder instanceof ASObject ? holder : this.#initScript(holder);
    }
    return undefined;
  }

  /** 完全な名前（"flash.display::MovieClip" や "Main"）からクラスを得る。 */
  classByName(name) {
    const at = name.lastIndexOf('::');
    const dot = name.lastIndexOf('.');
    const [pkg, short] = at >= 0 ? [name.slice(0, at), name.slice(at + 2)] : dot >= 0 ? [name.slice(0, dot), name.slice(dot + 1)] : ['', name];
    const key = `p:${pkg}|${short}`;
    const holder = this.globalHolder([key]);
    const value = holder?.values.get(key);
    return value instanceof ASClass ? value : undefined;
  }

  // --- 名前 ---

  #traitKey(abc, trait) {
    const m = abc.multinames[trait.name];
    return m?.kind === 'QName' && m.ns ? `${nsKey(m.ns)}|${m.name}` : null;
  }

  /**
   * multiname を、実行時の名前 { name, keys } にする。keys は探すキー（名前空間ごと）の並び。
   * 実行時に決まる部分（名前や名前空間）は stack から取り出す。
   */
  resolveName(abc, index, stack) {
    const m = abc.multinames[index];
    if (!m) return { name: '', keys: EMPTY };
    if (m.resolved) return m.resolved;
    if (m.kind === 'QName') return (m.resolved = { name: m.name, keys: [`${nsKey(m.ns ?? { kind: 'any', uri: '' })}|${m.name}`], attribute: m.attribute });
    if (m.kind === 'Multiname') return (m.resolved = { name: m.name, keys: m.nsSet.map((ns) => `${nsKey(ns)}|${m.name}`), attribute: m.attribute });
    if (m.kind === 'TypeName') return (m.resolved = { ...this.resolveName(abc, m.base, stack), typeParams: m.params });
    // ここから下は実行時に決まる
    let name = m.name;
    if (m.kind === 'MultinameL' || m.kind === 'RTQNameL') name = stack.pop();
    let spaces = m.nsSet;
    if (m.kind === 'RTQName' || m.kind === 'RTQNameL') {
      const ns = stack.pop();
      spaces = [ns?.namespace ?? { kind: 'package', uri: '' }];
    }
    // 数値の名前（配列の添字）はそのまま持つ。QName オブジェクトなら、その名前空間と名前を使う。
    if (name instanceof ASObject && name.qname) return { name: name.qname.name, keys: [`${nsKey(name.qname.ns)}|${name.qname.name}`] };
    const text = typeof name === 'number' ? name : this.toStr(name);
    return { name: text, keys: spaces.map((ns) => `${nsKey(ns)}|${text}`), late: true };
  }

  // --- クラスの組み立て ---

  // trait の並びから、スロットの初期値と番号を持つ「形」を作る（スクリプトの大域オブジェクトやアクティベーション用の擬似クラス）。
  #shape(abc, traitList, name, scope) {
    const shape = new ASClass(this, { name, superClass: null, dynamic: name === 'global' });
    shape.allocate = (klass) => new ASObject(klass);
    this.#addTraits(shape, shape.instanceTraits, abc, traitList, scope);
    return shape;
  }

  // 型の名前から、そのスロットの初期値を決める。
  #defaultOf(abc, typeIndex) {
    if (typeIndex === 0) return undefined; // 型なし (*)
    const m = abc.multinames[typeIndex];
    if (m?.kind === 'QName' && nsKey(m.ns) === PUBLIC) {
      if (m.name === 'int' || m.name === 'uint') return 0;
      if (m.name === 'Number') return NaN;
      if (m.name === 'Boolean') return false;
    }
    return null;
  }

  #addTraits(klass, table, abc, traitList, scope) {
    klass.slotKeys ??= [];
    const slotKeys = table === klass.staticTraits ? (klass.staticSlotKeys ??= []) : klass.slotKeys;
    for (const t of traitList) {
      const key = this.#traitKey(abc, t);
      if (!key) continue;
      const name = abc.multinames[t.name].name;
      if (t.kind === 'slot' || t.kind === 'const') {
        table.set(key, { kind: t.kind, key, name, type: t.typeName, abc, value: t.hasValue ? t.value : this.#defaultOf(abc, t.typeName) });
        if (t.slotId) slotKeys[t.slotId] = key;
      } else if (t.kind === 'class') {
        table.set(key, { kind: 'const', key, name, type: 0, abc, value: null });
        if (t.slotId) slotKeys[t.slotId] = key;
      } else if (t.kind === 'function') {
        table.set(key, { kind: 'slot', key, name, type: 0, abc, value: undefined, functionMethod: abc.methods[t.method] });
        if (t.slotId) slotKeys[t.slotId] = key;
      } else {
        const fn = new ASFunction(this, { method: abc.methods[t.method], scope, owner: klass, name });
        if (t.kind === 'method') table.set(key, { kind: 'method', key, name, fn });
        else {
          const old = table.get(key);
          const accessor = old?.kind === 'accessor' ? { ...old } : { kind: 'accessor', key, name, get: null, set: null };
          accessor[t.kind === 'getter' ? 'get' : 'set'] = fn;
          table.set(key, accessor);
        }
      }
    }
  }

  /** newclass: ABC のクラス定義 index から、基底クラス base のもとでクラスを作る。scope は作られた場所のスコープ。 */
  createClass(abc, index, base, scope) {
    const inst = abc.instances[index];
    const info = abc.classes[index];
    if (!inst || !info) this.throwError('VerifyError', 1014, 'Class could not be found.');
    const m = abc.multinames[inst.name];
    const klass = new ASClass(this, {
      name: m?.ns?.uri ? `${m.ns.uri}::${m.name}` : m?.name ?? '', superClass: base instanceof ASClass ? base : null,
      isInterface: inst.isInterface, dynamic: !inst.sealed, final: inst.final,
    });
    for (const i of inst.interfaces) {
      const found = this.#lookupClass(abc, i);
      if (found) for (const x of [found, ...found.interfaces]) klass.interfaces.add(x);
    }
    const classScope = [...scope, { object: klass }];
    // protected のメンバーは、派生クラスからは派生クラス自身の protected 名前空間で参照される。継承したぶんに別名を付ける。
    if (inst.protectedNs) {
      const own = nsKey(inst.protectedNs);
      for (let c = klass.superClass; c; c = c.superClass) {
        if (!c.protectedKey) continue;
        for (const [key, trait] of klass.instanceTraits) {
          if (key.startsWith(`${c.protectedKey}|`)) klass.instanceTraits.set(`${own}|${trait.name}`, trait);
        }
      }
      klass.protectedKey = own;
    }
    klass.slotKeys = [...(klass.superClass?.slotKeys ?? [])];
    this.#addTraits(klass, klass.instanceTraits, abc, inst.traits, classScope);
    this.#addTraits(klass, klass.staticTraits, abc, info.traits, classScope);
    this.#initSlots(klass, klass.staticTraits);
    klass.constructorFn = new ASFunction(this, { method: abc.methods[inst.init], scope: classScope, owner: klass, name: m?.name });
    // クラスの初期化 (static initializer)
    this.call(new ASFunction(this, { method: abc.methods[info.init], scope: classScope, owner: klass }), klass, []);
    return klass;
  }

  #lookupClass(abc, multinameIndex) {
    const { keys } = this.resolveName(abc, multinameIndex, EMPTY);
    const holder = this.globalHolder(keys);
    for (const key of keys) {
      const v = holder?.values.get(key);
      if (v instanceof ASClass) return v;
    }
    return undefined;
  }

  // スロットに初期値を入れる。
  #initSlots(obj, table) {
    for (const trait of table.values()) if ((trait.kind === 'slot' || trait.kind === 'const') && !obj.values.has(trait.key)) obj.values.set(trait.key, trait.value);
  }

  /** オブジェクトのスロットに、クラスで決まる初期値を入れる。 */
  initObject(obj) {
    this.#initSlots(obj, obj.klass.instanceTraits);
  }

  /** メソッド本体のアクティベーション（局所変数の置き場）を作る。 */
  newActivation(abc, body) {
    body.shape ??= this.#shape(abc, body.traits, 'activation', null);
    const obj = new ASObject(body.shape);
    this.#initSlots(obj, body.shape.instanceTraits);
    return obj;
  }

  /** catch で捕まえた値を入れるスコープのオブジェクトを作る。 */
  newCatch(abc, exception) {
    if (!exception) return new ASObject(this.classes.Object);
    if (!exception.shape) {
      exception.shape = new ASClass(this, { name: 'catch', superClass: null });
      const m = abc.multinames[exception.varName];
      if (m?.kind === 'QName') {
        const key = `${nsKey(m.ns)}|${m.name}`;
        exception.shape.instanceTraits.set(key, { kind: 'slot', key, name: m.name, type: 0, abc, value: undefined });
        exception.shape.slotKeys = [undefined, key];
      }
    }
    return new ASObject(exception.shape);
  }

  /** 名前空間の値（Namespace オブジェクト）。 */
  newNamespace(ns) {
    const obj = new ASObject(this.classes.Namespace ?? this.classes.Object);
    obj.namespace = ns ?? { kind: 'package', uri: '' };
    return obj;
  }

  /** 組み込みのクラスを定義して、大域に登録する（toplevel.js / flash.js が使う）。 */
  defineClass({ name, base = this.classes.Object, dynamic = false, isInterface = false, final = false, interfaces = [],
    construct = null, allocate = null, callAsFunction = null, methods = {}, getters = {}, setters = {}, slots = {},
    staticMethods = {}, staticValues = {}, prototypeMethods = {} }) {
    const klass = new ASClass(this, { name, superClass: base ?? null, dynamic, isInterface, final });
    for (const i of interfaces) for (const x of [i, ...i.interfaces]) klass.interfaces.add(x);
    if (allocate) klass.allocate = allocate;
    klass.callAsFunction = callAsFunction;
    const fn = (impl, label) => new ASFunction(this, { native: impl, name: label, owner: klass });
    klass.constructorFn = construct ? fn(construct, klass.shortName) : base?.constructorFn ?? null; // 省略すると、継承元と同じ初期化
    for (const [key, impl] of Object.entries(methods)) klass.instanceTraits.set(publicKey(key), { kind: 'method', key: publicKey(key), name: key, fn: fn(impl, key) });
    for (const key of new Set([...Object.keys(getters), ...Object.keys(setters)])) {
      const old = klass.instanceTraits.get(publicKey(key));
      klass.instanceTraits.set(publicKey(key), {
        kind: 'accessor', key: publicKey(key), name: key,
        get: getters[key] ? fn((self) => getters[key](self), key) : old?.get ?? null,
        set: setters[key] ? fn((self, [v]) => setters[key](self, v), key) : old?.set ?? null,
      });
    }
    for (const [key, value] of Object.entries(slots)) klass.instanceTraits.set(publicKey(key), { kind: 'slot', key: publicKey(key), name: key, type: 0, value });
    for (const [key, impl] of Object.entries(staticMethods)) klass.staticTraits.set(publicKey(key), { kind: 'method', key: publicKey(key), name: key, fn: fn(impl, key) });
    for (const [key, value] of Object.entries(staticValues)) {
      klass.staticTraits.set(publicKey(key), { kind: 'const', key: publicKey(key), name: key, type: 0, value });
      klass.values.set(publicKey(key), value);
    }
    for (const [key, impl] of Object.entries(prototypeMethods)) klass.prototype.values.set(publicKey(key), fn(impl, key));
    this.defineGlobal(name, klass);
    return klass;
  }

  /** 組み込みの大域の定義（クラスや関数）を登録する。name は "flash.utils::getTimer" の形。 */
  defineGlobal(name, value) {
    const at = name.lastIndexOf('::');
    const key = `p:${at >= 0 ? name.slice(0, at) : ''}|${at >= 0 ? name.slice(at + 2) : name}`;
    this.nativeGlobal ??= new ASObject(null);
    this.nativeGlobal.values.set(key, value);
    this.definitions.set(key, this.nativeGlobal);
  }

  /** ネイティブの関数を作る。 */
  native(impl, name = '') {
    return new ASFunction(this, { native: impl, name });
  }

  /** obj がその名前のメンバー（クラスで宣言されたもの）を持つか。 */
  hasTrait(obj, rn) {
    return obj !== null && obj !== undefined && this.#findTrait(obj, rn) !== undefined;
  }

  // --- 生成と呼び出し ---

  /** new klass(...args)。 */
  construct(klass, args) {
    if (klass instanceof ASClass) {
      if (klass.isInterface) this.throwError('TypeError', 1007, 'Instantiation attempted on a non-constructor.');
      const obj = klass.allocate(klass, args);
      if (!(obj instanceof ASObject)) return obj; // int や String など、基本型になるクラス
      this.#initSlots(obj, klass.instanceTraits);
      if (klass.constructorFn) this.call(klass.constructorFn, obj, args);
      return obj;
    }
    if (klass instanceof ASFunction) {
      // 関数を new した場合: prototype を継ぐ Object を作って、関数を呼ぶ。
      const obj = new ASObject(this.classes.Object);
      const proto = klass.values.get(publicKey('prototype'));
      obj.proto = proto instanceof ASObject ? proto : null;
      const result = this.call(klass, obj, args);
      return result instanceof ASObject ? result : obj;
    }
    return this.throwError('TypeError', 1007, 'Instantiation attempted on a non-constructor.');
  }

  /** 関数を呼ぶ。スクリプトの関数は interp.js が実行する。 */
  call(fn, thisValue, args) {
    if (fn instanceof ASClass) return fn.callAsFunction ? fn.callAsFunction(args) : this.coerceTo(fn, args[0]);
    if (!(fn instanceof ASFunction)) return this.throwError('TypeError', 1006, 'value is not a function.');
    const self = fn.boundThis !== undefined ? fn.boundThis : thisValue;
    if (fn.native) {
      // 組み込みの実装が想定外の値で JS の例外を出しても、プレイヤーごと落とさない。スクリプトの TypeError として扱う。
      // スタックの使い切りは、スクリプトから捕まえて続けられないように、実行の上限の超過にする。
      try {
        return fn.native(self, args);
      } catch (e) {
        if (e instanceof ASThrown || e instanceof AVM2LimitError) throw e;
        if (e instanceof RangeError && /call stack/i.test(e.message)) throw new AVM2LimitError('script recursion is too deep');
        if (e instanceof TypeError || e instanceof RangeError) return this.throwError('TypeError', 1009, 'Cannot access a property or method of a null object reference.');
        throw e;
      }
    }
    if (!fn.method?.body) return undefined;
    if (this.depth >= this.maxDepth) this.throwError('Error', 1023, 'Stack overflow occurred.');
    this.depth++;
    try {
      return execute(this, fn, self, args);
    } finally {
      this.depth--;
    }
  }

  /**
   * スクリプトの入口（フレームスクリプトやイベントハンドラ）。命令数と割り当て数の上限を設けて fn を実行する。
   * 捕まえられなかった例外は onError に渡す（既定では trace に出す）。上限を超えたら、以後のスクリプトを止める。
   */
  run(body, onError = (text) => this.trace(text)) {
    if (this.disabled) return undefined;
    const outer = this.running;
    if (!outer) {
      this.steps = this.maxSteps;
      this.allocations = this.maxAllocations;
      this.running = true;
    }
    try {
      return body();
    } catch (e) {
      if (e instanceof ASThrown) {
        onError(this.describeError(e.value));
        return undefined;
      }
      if (e instanceof AVM2LimitError) {
        this.disabled = true;
        onError(`scripts are disabled: ${e.message}`);
        return undefined;
      }
      throw e;
    } finally {
      this.running = outer;
      if (!outer) {
        this.steps = Infinity;
        this.allocations = Infinity;
      }
    }
  }

  /** 捕まえられなかった例外の表示（実機のデバッガ版が出す 1 行目に合わせる）。 */
  describeError(value) {
    if (value instanceof ASObject && value.klass?.isSubclassOf?.(this.classes.Error)) {
      return `${value.klass.shortName}: ${this.toStr(value.values.get(publicKey('message')))}`;
    }
    return this.toStr(value);
  }

  // --- プロパティ ---

  /** 値のクラス。基本型は対応するクラス。 */
  classOf(v) {
    if (v instanceof ASObject) return v.klass;
    if (typeof v === 'number') return Number.isInteger(v) && v >= -2147483648 && v <= 2147483647 ? this.classes.int : this.classes.Number;
    if (typeof v === 'string') return this.classes.String;
    if (typeof v === 'boolean') return this.classes.Boolean;
    return null;
  }

  // オブジェクトのメンバー表（クラスなら静的メンバー、それ以外はインスタンスのメンバー）。
  #traitsOf(obj) {
    if (obj instanceof ASClass) return obj.staticTraits;
    const klass = this.classOf(obj);
    return klass?.instanceTraits;
  }

  #findTrait(obj, rn) {
    const table = this.#traitsOf(obj);
    if (table) for (const key of rn.keys) { const t = table.get(key); if (t) return t; }
    // クラスオブジェクトは、Class のインスタンスのメンバー（prototype など）も持つ。
    if (obj instanceof ASClass && this.classes.Class) for (const key of rn.keys) { const t = this.classes.Class.instanceTraits.get(key); if (t) return t; }
    return undefined;
  }

  #nullCheck(obj, rn) {
    if (obj === null) this.throwError('TypeError', 1009, 'Cannot access a property or method of a null object reference.');
    if (obj === undefined) this.throwError('TypeError', 1010, 'A term is undefined and has no properties.');
    void rn;
  }

  // 公開の名前空間で探してよい名前か（動的なプロパティは公開の名前だけ）。
  #publicName(rn) {
    return rn.late || rn.keys.some((key) => key.startsWith(`${PUBLIC}|`)) ? publicKey(rn.name) : null;
  }

  getProperty(obj, rn) {
    this.#nullCheck(obj, rn);
    // 配列と文字列の添字
    if (obj instanceof ASArray && this.#isIndex(rn.name)) return obj.items[Number(rn.name)];
    if (typeof obj === 'string' && this.#isIndex(rn.name)) return obj[Number(rn.name)];
    const trait = this.#findTrait(obj, rn);
    if (trait) {
      if (trait.kind === 'slot' || trait.kind === 'const') return obj.values.get(trait.key);
      if (trait.kind === 'method') return this.#closure(obj, trait);
      if (trait.get) return this.call(trait.get, obj, []);
      return this.throwError('ReferenceError', 1077, `Illegal read of write-only property ${trait.name} on ${this.className(obj)}.`);
    }
    // 組み込みの大域定義の置き場は、名前空間つきのキーでそのまま値を持つ。
    if (obj === this.nativeGlobal) {
      for (const k of rn.keys) if (obj.values.has(k)) return obj.values.get(k);
      return undefined;
    }
    const key = this.#publicName(rn);
    if (key !== null) {
      if (obj instanceof ASObject && obj.values.has(key)) return obj.values.get(key);
      // prototype をたどる
      for (let p = obj instanceof ASObject && obj.proto !== undefined ? obj.proto : this.classOf(obj)?.prototype; p; p = p.proto) {
        if (p.values.has(key)) return p.values.get(key);
      }
    }
    const klass = this.classOf(obj);
    if (klass && !klass.dynamic && !(obj instanceof ASClass)) {
      this.throwError('ReferenceError', 1069, `Property ${rn.name} not found on ${this.className(obj)} and there is no default value.`);
    }
    return undefined;
  }

  // メソッドを値として取り出す（this を覚えたクロージャ）。同じオブジェクトの同じメソッドは同じ値になる。
  #closure(obj, trait) {
    if (!(obj instanceof ASObject)) return new ASFunction(this, { ...trait.fn, native: trait.fn.native, method: trait.fn.method, scope: trait.fn.scope, owner: trait.fn.owner, boundThis: obj });
    obj.closures ??= new Map();
    let fn = obj.closures.get(trait.key);
    if (!fn) {
      fn = new ASFunction(this, { native: trait.fn.native, method: trait.fn.method, scope: trait.fn.scope, owner: trait.fn.owner, name: trait.name, boundThis: obj });
      obj.closures.set(trait.key, fn);
    }
    return fn;
  }

  #isIndex(name) {
    if (typeof name === 'number') return Number.isInteger(name) && name >= 0;
    return typeof name === 'string' && /^(0|[1-9]\d{0,9})$/.test(name);
  }

  /** プロパティへの代入。init は、定数の初期化（initproperty）のとき真。 */
  setProperty(obj, rn, value, init = false) {
    this.#nullCheck(obj, rn);
    if (obj instanceof ASArray && this.#isIndex(rn.name)) {
      const i = Number(rn.name);
      if (i >= 1 << 24) this.throwError('RangeError', 1005, `Array index out of bounds ${i}.`);
      if (i >= obj.items.length) this.charge(i - obj.items.length + 1);
      obj.items[i] = value;
      return;
    }
    const trait = this.#findTrait(obj, rn);
    if (trait) {
      if (trait.kind === 'slot' || (trait.kind === 'const' && init)) {
        obj.values.set(trait.key, trait.type ? this.coerceByName(trait.abc, trait.type, value) : value);
      } else if (trait.kind === 'const') {
        this.throwError('ReferenceError', 1074, `Illegal write to read-only property ${trait.name} on ${this.className(obj)}.`);
      } else if (trait.kind === 'method') {
        this.throwError('ReferenceError', 1037, `Cannot assign to a method ${trait.name} on ${this.className(obj)}.`);
      } else if (trait.set) {
        this.call(trait.set, obj, [value]);
      } else {
        this.throwError('ReferenceError', 1074, `Illegal write to read-only property ${trait.name} on ${this.className(obj)}.`);
      }
      return;
    }
    const key = this.#publicName(rn);
    const klass = this.classOf(obj);
    if (key === null || !(obj instanceof ASObject) || (!klass?.dynamic && !(obj instanceof ASClass) && obj.proto === undefined)) {
      this.throwError('ReferenceError', 1056, `Cannot create property ${rn.name} on ${this.className(obj)}.`);
    }
    if (!obj.values.has(key)) this.charge(1);
    obj.values.set(key, value);
  }

  hasProperty(obj, rn) {
    if (obj === null || obj === undefined) return false;
    if (obj instanceof ASArray && this.#isIndex(rn.name)) return Number(rn.name) in obj.items;
    if (this.#findTrait(obj, rn)) return true;
    if (obj === this.nativeGlobal) return rn.keys.some((k) => obj.values.has(k));
    const key = this.#publicName(rn);
    if (key === null) return false;
    if (obj instanceof ASObject && obj.values.has(key)) return true;
    for (let p = obj instanceof ASObject && obj.proto !== undefined ? obj.proto : this.classOf(obj)?.prototype; p; p = p.proto) if (p.values.has(key)) return true;
    return false;
  }

  deleteProperty(obj, rn) {
    if (!(obj instanceof ASObject)) return false;
    if (obj instanceof ASArray && this.#isIndex(rn.name)) {
      delete obj.items[Number(rn.name)];
      return true;
    }
    if (this.#findTrait(obj, rn)) return false;
    const key = this.#publicName(rn);
    return key !== null && obj.values.delete(key);
  }

  /** obj.name(...args)。 */
  callProperty(obj, rn, args) {
    this.#nullCheck(obj, rn);
    const trait = this.#findTrait(obj, rn);
    if (trait?.kind === 'method') return this.call(trait.fn, obj, args);
    // 数値や文字列などの基本型では、無いメソッドの呼び出しは「関数ではない」になる（オブジェクトでは「プロパティが無い」。実機で確認）。
    if (!(obj instanceof ASObject) && !this.hasProperty(obj, rn)) this.throwError('TypeError', 1006, `${rn.name} is not a function.`);
    const fn = this.getProperty(obj, rn);
    if (fn instanceof ASFunction) return this.call(fn, fn.boundThis !== undefined ? fn.boundThis : obj, args);
    if (fn instanceof ASClass) return this.call(fn, null, args);
    return this.throwError('TypeError', 1006, `${rn.name} is not a function.`);
  }

  /** 列挙できる名前（動的なプロパティと配列の添字）。for..in 用。 */
  enumerate(obj) {
    if (!(obj instanceof ASObject)) return [];
    const names = [];
    if (obj instanceof ASArray) for (let i = 0; i < obj.items.length; i++) if (i in obj.items) names.push(i);
    const traits = this.#traitsOf(obj);
    const prefix = `${PUBLIC}|`;
    for (const key of obj.values.keys()) {
      if (key.startsWith(prefix) && !traits?.has(key) && !obj.hidden?.has(key)) names.push(key.slice(prefix.length));
    }
    return names;
  }

  // --- 型 ---

  className(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'void';
    if (v instanceof ASClass) return `${v.shortName}$`;
    return this.classOf(v)?.name.replace('::', '.') ?? 'Object';
  }

  /** v が klass のインスタンスか（is 演算子）。 */
  isType(v, klass) {
    if (v === null || v === undefined || !(klass instanceof ASClass)) return false;
    const c = this.classes;
    if (klass === c.Object) return true;
    if (klass === c.Number) return typeof v === 'number';
    if (klass === c.int) return typeof v === 'number' && Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;
    if (klass === c.uint) return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4294967295;
    if (klass === c.String) return typeof v === 'string';
    if (klass === c.Boolean) return typeof v === 'boolean';
    if (!(v instanceof ASObject)) return false;
    if (v instanceof ASClass) return klass === c.Class;
    return v.klass?.isSubclassOf(klass) ?? false;
  }

  /** 値をクラス klass の型に合わせる（代入や引数の型変換）。合わなければ TypeError。 */
  coerceTo(klass, v) {
    const c = this.classes;
    if (klass === c.int) return this.toInt32(v);
    if (klass === c.uint) return this.toUint32(v);
    if (klass === c.Number) return this.toNumber(v);
    if (klass === c.Boolean) return this.toBoolean(v);
    if (klass === c.String) return v === null || v === undefined ? null : this.toStr(v);
    if (klass === c.Object) return v === undefined ? null : v;
    if (v === null || v === undefined) return null;
    if (this.isType(v, klass)) return v;
    return this.throwError('TypeError', 1034, `Type Coercion failed: cannot convert ${this.describe(v)} to ${klass.name.replace('::', '.')}.`);
  }

  /** multiname で指定された型に合わせる。型が見つからなければそのまま返す。 */
  coerceByName(abc, typeIndex, v) {
    if (typeIndex === 0) return v;
    const m = abc.multinames[typeIndex];
    if (m.typeClass === undefined) m.typeClass = this.#lookupClass(abc, typeIndex) ?? null;
    return m.typeClass ? this.coerceTo(m.typeClass, v) : v;
  }

  // エラーメッセージ用の値の表記（実機と同じ形: オブジェクトは "クラス名@アドレス"）。
  describe(v) {
    if (typeof v === 'string') return `"${v}"`;
    if (v instanceof ASObject && !(v instanceof ASClass)) return `${this.className(v)}@0`;
    return this.toStr(v);
  }

  // --- 変換 ---

  // オブジェクトを基本型にする。hint が 'string' なら toString を先に試す。
  toPrimitive(v, hint) {
    if (!(v instanceof ASObject)) return v;
    for (const name of hint === 'string' ? ['toString', 'valueOf'] : ['valueOf', 'toString']) {
      const rn = { name, keys: [publicKey(name)] };
      const trait = this.#findTrait(v, rn);
      const fn = trait?.kind === 'method' ? trait.fn : this.hasProperty(v, rn) ? this.getProperty(v, rn) : undefined;
      if (fn instanceof ASFunction) {
        const r = this.call(fn, v, []);
        if (!(r instanceof ASObject)) return r;
      }
    }
    return this.throwError('TypeError', 1050, `Cannot convert ${this.className(v)} to primitive.`);
  }

  toNumber(v) {
    switch (typeof v) {
      case 'number': return v;
      case 'undefined': return NaN;
      case 'boolean': return v ? 1 : 0;
      case 'string': {
        const s = v.trim();
        if (s === '') return 0;
        return /^[+-]?(0[xX][0-9a-fA-F]+|Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)$/.test(s) ? Number(s) : NaN;
      }
      default: return v === null ? 0 : v instanceof ASObject ? this.toNumber(this.toPrimitive(v, 'number')) : NaN;
    }
  }

  toInt32(v) {
    return this.toNumber(v) | 0;
  }

  toUint32(v) {
    return this.toNumber(v) >>> 0;
  }

  toBoolean(v) {
    switch (typeof v) {
      case 'boolean': return v;
      case 'number': return v !== 0 && !Number.isNaN(v);
      case 'string': return v !== '';
      case 'undefined': return false;
      default: return v !== null;
    }
  }

  toStr(v) {
    switch (typeof v) {
      case 'string': return v;
      case 'number': return numberText(v);
      case 'boolean': return v ? 'true' : 'false';
      case 'undefined': return 'undefined';
      // スクリプトの値は基本型か ASObject だけ。それ以外（ホスト側の値）が紛れ込んでも、中身には触れない。
      default: return v === null ? 'null' : v instanceof ASObject ? this.toStr(this.toPrimitive(v, 'string')) : '[object]';
    }
  }

  /** == の比較。 */
  equals(a, b) {
    if (a === b) return true;
    const nullish = (v) => v === null || v === undefined;
    if (nullish(a) || nullish(b)) return nullish(a) && nullish(b);
    const ta = typeof a, tb = typeof b;
    if (ta === 'object' && tb === 'object') {
      // QName と Namespace は中身で比べる
      if (a.qname && b.qname) return a.qname.name === b.qname.name && nsKey(a.qname.ns) === nsKey(b.qname.ns);
      if (a.namespace && b.namespace) return nsKey(a.namespace) === nsKey(b.namespace);
      // メソッドクロージャは、同じオブジェクトの同じメソッドなら等しい
      return a instanceof ASFunction && b instanceof ASFunction && a.boundThis !== undefined && a.boundThis === b.boundThis && a.method === b.method && a.native === b.native;
    }
    if (ta === 'object') return this.equals(this.toPrimitive(a, 'number'), b);
    if (tb === 'object') return this.equals(a, this.toPrimitive(b, 'number'));
    if (ta === tb) return false; // 同じ基本型で === でない（NaN を含む）
    return this.toNumber(a) === this.toNumber(b);
  }

  /** a < b。どちらかが NaN なら undefined。 */
  lessThan(a, b) {
    const pa = this.toPrimitive(a, 'number');
    const pb = this.toPrimitive(b, 'number');
    if (typeof pa === 'string' && typeof pb === 'string') return pa < pb;
    const na = this.toNumber(pa), nb = this.toNumber(pb);
    return Number.isNaN(na) || Number.isNaN(nb) ? undefined : na < nb;
  }

  /** + 演算子。数値どうしなら和、どちらかが文字列なら連結。 */
  add(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a + b;
    // 片方が文字列なら、もう片方は文字列として読む（オブジェクトは valueOf より toString が先。実機で確認）。
    const hint = typeof a === 'string' || typeof b === 'string' ? 'string' : 'default';
    const pa = this.toPrimitive(a, hint);
    const pb = this.toPrimitive(b, hint);
    if (typeof pa === 'string' || typeof pb === 'string') {
      const s = this.toStr(pa) + this.toStr(pb);
      if (s.length > 1 << 24) throw new AVM2LimitError('string is too long');
      return s;
    }
    return this.toNumber(pa) + this.toNumber(pb);
  }

  typeOf(v) {
    if (v === null) return 'object';
    if (v instanceof ASFunction) return 'function';
    if (v instanceof ASObject) return v.xml ? 'xml' : 'object';
    return typeof v;
  }
}

/** 数値の文字列化。AS3 は ECMAScript と同じ規則（有効桁数は最短で往復できる長さ）。 */
export function numberText(n) {
  const text = String(n);
  // 指数表記になる大きな数（1e21 以上）は、有効数字が 15 桁までで、それを超えるぶんは切り捨てられる（実機で確認）。
  const m = /^(-?)(\d)\.(\d{15,})e\+(\d+)$/.exec(text);
  return m ? `${m[1]}${m[2]}.${m[3].slice(0, 14)}e+${m[4]}` : text;
}
