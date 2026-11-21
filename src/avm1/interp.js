// AVM1 のインタプリタ（仕様 5 章）。バイトコードをそのまま 1 命令ずつ解釈する。
// JS へのコード生成や eval は使わない。
import { lessThan, looseEquals, toBool, toInt32, toNumber, toPrimitive, toStr, typeOf } from './convert.js';
import { installGlobals } from './globals.js';
import { AVMArray, AVMFunction, AVMObject, DONT_ENUM } from './object.js';
import { byteString } from '../swf/legacy.js';

/** 上限超過など、スクリプトからは捕まえられない中断。 */
export class AVMError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AVMError';
  }
}

// スクリプトが throw した値を運ぶ。
class Thrown {
  constructor(value) {
    this.value = value;
  }
}

// return で関数（またはブロック）を抜けることを呼び出し元へ伝える。
class Return {
  constructor(value) {
    this.value = value;
  }
}

const MAX_STRING = 1 << 24; // 連結でこれを超える文字列は作らせない
const PROPERTIES = [
  '_x', '_y', '_xscale', '_yscale', '_currentframe', '_totalframes', '_alpha', '_visible', '_width', '_height',
  '_rotation', '_target', '_framesloaded', '_name', '_droptarget', '_url', '_highquality', '_focusrect',
  '_soundbuftime', '_quality', '_xmouse', '_ymouse',
];
const decoder = new TextDecoder();


// super。メソッドを見つけたオブジェクト (holder) の 1 つ上から探し、this は元のオブジェクトのままで呼ぶ。
class SuperObject extends AVMObject {
  constructor(vm, thisObj, holder) {
    super(vm, null);
    this.thisObj = thisObj;
    this.holder = holder;
  }

  ownGet(name) {
    const base = this.holder?.proto;
    return base ? base.get(name, this.thisObj) : undefined;
  }
}

/** プレイヤーの版。$version と System.capabilities.version の値（実機のデバッガ版が返す文字列）。 */
export const PLAYER_VERSION = 'MAC 35,0,0,61';

export class AVM1 {
  /**
   * @param {object} options
   *   version: SWF のバージョン（型変換や大文字小文字の扱いが変わる）
   *   trace: (text) => void                trace() の出力先
   *   now: () => number                    getTimer() 用の経過ミリ秒
   *   random: () => number                 0 以上 1 未満の乱数
   *   maxSteps / maxAllocations: 1 回のスクリプト実行で許す命令数・割り当て数
   *   maxDepth: 関数呼び出しの深さの上限（実機は 256）
   *   legacy: SWF 5 以前の文字列の扱い（LegacyText）。SWF 6 以降は null
   *   stage: { width, height }   ステージの大きさ (px)。Stage.width / height の値
   *   language: System.capabilities.language の値（'ja' など）
   *   request: ({ kind, url, target, method }) => void   getURL / loadMovie / loadVariables の要求の通知先。
   *            通知するだけで、移動も読み込みもしない
   *   navigate: ({ url, target, method, data }) => void   移動を、ホストに任せるための関数（既定は何もしない）
   *   focus: { get, set }   キーボードのフォーカスの読み書き（プレイヤーの movie.focus）
   *   load: (要求, done, { sync }) => void   読み込みを、ホストに任せるための関数。done(バイト列 | null) を、後のフレームの処理の中で
   *            呼ぶ（sync なら、ホストがその場で返したときはその場で呼ぶ）。既定は、読めなかった扱い（null）
   */
  constructor({ version = 8, trace = () => {}, now = () => 0, random = Math.random, maxSteps = 2e7, maxAllocations = 4e6, maxDepth = 256, legacy = null, request = () => {}, navigate = () => {}, load = null, storage = null, stage = { width: 550, height: 400 }, language = 'en', focus = null, fscommand2 = null } = {}) {
    this.request = request;
    this.fscommand2 = fscommand2; // Flash Lite の FSCommand2 を処理する関数（無ければ、命令を読み飛ばす）
    this.focus = focus ?? { get: () => null, set: () => {} }; // キーボードのフォーカス: { get() → 表示オブジェクト | null, set(表示オブジェクト | null) }（Selection 用）
    this.navigate = navigate;
    this.storage = storage; // SharedObject の保存先（player/sharedstore.js の説明）。無ければ、再生中だけ値を持つ
    this.load = load ?? ((req, done, { sync = false } = {}) => (sync ? done(null) : this.later(() => done(null))));
    this.listeners = { Mouse: [], Key: [], Stage: [], Selection: [] }; // addListener で登録されたオブジェクト
    this.currentTarget = null;
    this.pending = []; // later() で予約した処理（読み込み失敗の通知など）。プレイヤーが次のフレームの後で実行する
    this.environment = { width: stage.width, height: stage.height, language };
    this.key = { code: 0, ascii: 0, down: new Set() }; // 最後に押されたキーと、押されているキー
    this.mouseVisible = true; // Mouse.hide() / Mouse.show()
    this.version = version;
    this.legacy = legacy; // SWF 5 以前: 文字列はバイト列のまま（swf/legacy.js の LegacyText）。それ以外は null
    this.caseInsensitive = version < 7;
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
    this.registers = [undefined, undefined, undefined, undefined]; // 関数の外と DefineFunction で共有する 4 本
    this.timers = new Map(); // setInterval / setTimeout の ID → タイマー
    this.nextTimer = 1;

    this.objectProto = new AVMObject(this, null);
    this.functionProto = new AVMObject(this, this.objectProto);
    this.arrayProto = new AVMObject(this, this.objectProto);
    this.global = new AVMObject(this, this.objectProto);
    installGlobals(this);
  }

  /** 割り当ての計上。1 回の実行での上限を超えたら中断する。 */
  charge(n) {
    this.allocations -= n;
    if (this.allocations < 0) throw new AVMError('script allocates too much');
  }

  /** ネイティブ関数を作る。 */
  native(fn, construct) {
    return new AVMFunction(this, { native: fn, construct });
  }

  /**
   * アクション列を 1 本実行する（フレームアクションやイベントハンドラの入口）。
   * スクリプトが投げて誰も捕まえなかった例外は、実機と同じく黙って捨てる。上限超過は AVMError として投げる。
   * @param {Uint8Array} code
   * @param {AVMObject} target  実行対象のムービークリップ（変数の置き場所であり this でもある）
   */
  run(code, target) {
    const frame = {
      scopes: [{ object: this.global }, { object: target, target: true }],
      thisValue: target, target, registers: this.registers, constants: [], superHolder: null,
    };
    this.#guarded(() => this.execute(code, 0, code.length, frame, []));
  }

  /** 関数値をホスト側から呼ぶ（イベントハンドラやタイマー）。run と同じ扱いで実行する。 */
  invoke(fn, thisValue, args = []) {
    let result;
    this.#guarded(() => {
      result = this.call(fn, thisValue, args);
    });
    return result;
  }

  /**
   * 期限の来たタイマー (setInterval / setTimeout) を、期限の早い順に実行する。
   * 1 回の呼び出しで実行するのは maxFires 回まで（間隔の短いタイマーで戻ってこなくなるのを防ぐ）。
   */
  runTimers(maxFires = 100) {
    const now = this.now();
    for (let fired = 0; fired < maxFires; fired++) {
      let due = null;
      for (const t of this.timers.values()) if (t.next <= now && (!due || t.next < due.next)) due = t;
      if (!due) return;
      if (due.once) this.timers.delete(due.id);
      else due.next += due.interval;
      const fn = due.object ? due.object.get(due.method) : due.fn;
      this.invoke(fn, due.object ?? undefined, due.args);
    }
    // 追いつけない分は捨てる。
    for (const t of this.timers.values()) if (t.next <= now) t.next = now + t.interval;
  }

  // 1 回のスクリプト実行。命令数と割り当ての上限をここで仕切る（入れ子の呼び出しでは仕切り直さない）。
  #guarded(body) {
    const outer = this.running;
    if (!outer) {
      this.steps = this.maxSteps;
      this.allocations = this.maxAllocations;
      this.depth = 0;
    }
    this.running = true;
    try {
      body();
    } catch (e) {
      if (!(e instanceof Thrown)) throw e;
    } finally {
      this.running = outer;
      if (!outer) {
        this.steps = Infinity;
        this.allocations = Infinity;
      }
    }
  }

  /** キーの状態を更新する（Key.getCode / getAscii / isDown 用）。 */
  keyEvent(code, ascii, down) {
    if (down) {
      this.key.code = code;
      this.key.ascii = ascii;
      this.key.down.add(code);
    } else {
      this.key.code = code;
      this.key.down.delete(code);
    }
  }

  /**
   * 文字のデータを読み込む（LoadVars、XML、loadVariables 用）。要求を記録して、ホストに読み込みを頼む。
   * done(文字列 | undefined, バイト数) を、後のフレームの処理の中で呼ぶ（読めなければ undefined）。
   * body は送る本文（文字列）。GET で送るときは、URL の後ろに付ける（URL に ? があれば &、無ければ ?）。
   * question が真なら、URL に ? があっても、本文が空でも、? を付けて続ける（LoadVars.sendAndLoad の GET。実機で確認）。
   * headers は、POST で送る追加のヘッダ（addRequestHeader。名前の小文字 → { name, value } の Map）。Content-Type があれば、それが優先される。
   */
  loadText({ kind = 'loadVariables', url, target = '', method = '', body = '', contentType = 'application/x-www-form-urlencoded', question = false, headers = null }, done) {
    this.request({ kind, url, target, method });
    const post = method.toUpperCase() === 'POST';
    const address = !post && question ? `${url}?${body}` : !post && body ? `${url}${url.includes('?') ? '&' : '?'}${body}` : url;
    const extra = {};
    if (post && headers) for (const { name, value } of headers.values()) extra[name] = value;
    const typeHeader = Object.keys(extra).find((name) => name.toLowerCase() === 'content-type');
    if (typeHeader) { contentType = extra[typeHeader]; delete extra[typeHeader]; }
    // SWF 5 以前の文字列は、バイト列をそのまま 1 文字ずつにしたもの。SWF 6 以降は UTF-8。
    const encode = (text) => (this.legacy ? Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff) : new TextEncoder().encode(text));
    const decode = (bytes) => (this.legacy ? Array.from(bytes, (b) => String.fromCharCode(b)).join('') : decoder.decode(bytes).replace(/^\uFEFF/, ''));
    this.load({ url: address, method: post ? 'POST' : 'GET', data: post ? encode(body) : null, contentType: post ? contentType : null, headers: Object.keys(extra).length ? extra : undefined }, (bytes) => done(bytes ? decode(bytes) : undefined, bytes?.length ?? 0));
  }

  /** 処理を予約する。次のフレームのスクリプトが済んだ後に実行される（実機で読み込みの失敗が届く時機）。 */
  later(fn) {
    if (this.pending.length < 10000) this.pending.push(fn);
  }

  /** Mouse / Key のリスナーの method を、登録順に呼ぶ。 */
  broadcast(name, method) {
    for (const listener of this.listeners[name].slice()) {
      const fn = listener.get(method);
      if (fn instanceof AVMFunction) this.invoke(fn, listener, []);
    }
  }

  // 表示オブジェクト（テキストフィールドかクリップ）から、スクリプトのオブジェクトへ。無ければ null。
  #scriptOf(display) {
    return display?.scriptObject?.() ?? null;
  }

  /**
   * フォーカスの移動を伝える。順序は、古いものの onKillFocus（引数は新しいもの）→ 新しいものの onSetFocus（引数は古いもの）→
   * Selection のリスナーの onSetFocus（古いもの、新しいもの）。
   */
  focusChange(old, now) {
    const [before, after] = [this.#scriptOf(old), this.#scriptOf(now)];
    const call = (object, method, args) => { const fn = object?.get(method); if (fn instanceof AVMFunction) this.invoke(fn, object, args); };
    call(before, 'onKillFocus', [after]);
    call(after, 'onSetFocus', [before]);
    for (const listener of this.listeners.Selection.slice()) call(listener, 'onSetFocus', [before, after]);
  }

  /** テキストフィールドのスクロールが変わったときの、field.onScroller(field)。 */
  scrolled(field) {
    const object = this.#scriptOf(field);
    const fn = object?.get('onScroller');
    if (fn instanceof AVMFunction) this.invoke(fn, object, [object]);
  }

  /** 入力でテキストフィールドの文字列が変わったときの、field.onChanged(field)。 */
  textChanged(field) {
    const object = this.#scriptOf(field);
    const fn = object?.get('onChanged');
    if (fn instanceof AVMFunction) this.invoke(fn, object, [object]);
  }

  /** 名前の照合用の小文字化。SWF 5 以前は英字だけを対象にする（2 バイト文字を壊さない）。 */
  lower(name) {
    return this.legacy ? this.legacy.lower(name) : name.toLowerCase();
  }

  /** 関数を呼ぶ。holder は関数が見つかったオブジェクト（super の起点）。関数でなければ undefined を返す。 */
  call(fn, thisValue, args, holder = null) {
    if (!(fn instanceof AVMFunction)) return undefined;
    if (fn.native) return fn.native(this, thisValue, args);
    const s = fn.script;
    if (!s) return undefined;
    if (this.depth >= this.maxDepth) throw new AVMError(`${this.maxDepth} levels of recursion were exceeded`);

    const activation = new AVMObject(this, null);
    const superHolder = holder ?? (thisValue instanceof AVMObject ? thisValue.proto : null);
    const makeArguments = () => {
      const a = new AVMArray(this, args.slice());
      a.define('callee', fn, DONT_ENUM);
      return a;
    };
    let registers = this.registers;
    if (s.function2) {
      registers = new Array(s.registerCount).fill(undefined);
      let r = 1;
      const f = s.flags;
      if (f & 0x0001) registers[r++] = thisValue;
      if (f & 0x0004) registers[r++] = makeArguments();
      else if (!(f & 0x0008)) activation.define('arguments', makeArguments());
      if (f & 0x0010) registers[r++] = new SuperObject(this, thisValue, superHolder);
      if (f & 0x0040) registers[r++] = s.target?.get('_root');
      if (f & 0x0080) registers[r++] = s.target?.get('_parent');
      if (f & 0x0100) registers[r++] = this.global;
      s.params.forEach((p, i) => {
        if (p.register) registers[p.register] = args[i];
        else activation.define(p.name, args[i]);
      });
    } else {
      s.params.forEach((p, i) => activation.define(p.name, args[i]));
      activation.define('arguments', makeArguments());
    }

    const frame = {
      scopes: [...s.scopes, { object: activation }],
      thisValue, target: s.target, registers, constants: s.constants, superHolder,
    };
    this.depth++;
    try {
      const done = this.execute(s.code, s.start, s.end, frame, []);
      return done instanceof Return ? done.value : undefined;
    } finally {
      this.depth--;
    }
  }

  /** new fn(...args)。 */
  construct(fn, args) {
    if (!(fn instanceof AVMFunction)) return undefined;
    const p = fn.get('prototype');
    const proto = p instanceof AVMObject ? p : this.objectProto;
    if (fn.construct) return fn.construct(this, args, proto);
    const obj = new AVMObject(this, proto);
    obj.define('__constructor__', fn, DONT_ENUM);
    if (this.version < 7) obj.define('constructor', fn, DONT_ENUM);
    this.call(fn, obj, args, proto);
    return obj;
  }

  /** obj が ctor のインスタンスか（プロトタイプ連鎖と、implements したインターフェース）。 */
  instanceOf(obj, ctor) {
    if (!(obj instanceof AVMObject) || !(ctor instanceof AVMFunction)) return false;
    const proto = ctor.get('prototype');
    for (let o = obj.proto, i = 0; o && i < 256; o = o.proto, i++) {
      if (o === proto) return true;
      if (o.interfaces?.some((it) => it === ctor || this.instanceOf(it.get('prototype'), ctor))) return true;
    }
    return false;
  }

  // --- プロパティと変数 ---

  /** obj.name の読み出し。基本型は対応するプロトタイプから探す。 */
  getMember(obj, name) {
    if (obj instanceof AVMObject) return obj.get(name);
    if (typeof obj === 'string') return name === 'length' ? obj.length : this.stringProto.get(name);
    if (typeof obj === 'number') return this.numberProto.get(name);
    if (typeof obj === 'boolean') return this.booleanProto.get(name);
    return undefined;
  }

  // 名前が「パス:変数」「パス.変数」「/パス」の形なら [オブジェクト, 変数名] に分ける。単純な名前なら null。
  #splitPath(frame, name) {
    let at = name.lastIndexOf(':');
    if (at < 0) at = name.includes('/') ? -1 : name.lastIndexOf('.');
    if (at < 0) {
      if (!name.includes('/')) return null;
      return [this.resolvePath(frame, name), null]; // パスだけ: そのクリップ自体を指す
    }
    return [this.resolvePath(frame, name.slice(0, at)), name.slice(at + 1)];
  }

  /** ターゲットパス（"/a/b"、"_root.a"、"../c"、"this.a" など）をオブジェクトにする。たどれなければ undefined。 */
  resolvePath(frame, path) {
    let cur = frame.target;
    let rest = path;
    if (rest.startsWith('/')) {
      cur = cur?.get('_root');
      rest = rest.slice(1);
    }
    // 区切りは "/"、"."、":"。ただし ".." は親を指す 1 つの要素（"../..:2" など）。
    const parts = [];
    for (let i = 0; i < rest.length;) {
      if (rest.startsWith('..', i)) {
        parts.push('..');
        i += 2;
      } else {
        let j = i;
        while (j < rest.length && !'/.:'.includes(rest[j])) j++;
        if (j > i) parts.push(rest.slice(i, j));
        i = j;
      }
      if (i < rest.length && '/.:'.includes(rest[i])) i++;
    }
    parts.forEach((part, i) => {
      if (cur === undefined) return;
      const child = cur?.isMovieClip && part !== '..' ? cur.child(part) : undefined;
      if (child) cur = child; // 同名の変数より、子のクリップを優先する
      else if (part === '..') cur = cur instanceof AVMObject ? cur.get('_parent') : undefined;
      else if (i === 0 && !path.startsWith('/')) cur = this.getVariable(frame, part); // 先頭はスコープから探す
      else cur = cur instanceof AVMObject ? cur.get(part) : undefined;
    });
    return cur instanceof AVMObject ? cur : undefined;
  }

  getVariable(frame, name) {
    const special = this.caseInsensitive ? this.lower(name) : name; // this なども SWF 6 以前は大文字小文字を区別しない
    if (special === 'this') return frame.thisValue;
    const path = this.#splitPath(frame, name);
    if (path) {
      const [obj, member] = path;
      if (member === null) return obj;
      if (obj) return obj.get(member);
      // たどれなかった場合は、点を含む名前の変数そのものとして探す
    }
    for (let i = frame.scopes.length - 1; i >= 0; i--) {
      const v = frame.scopes[i].object.get(name);
      if (v !== undefined || frame.scopes[i].object.has(name)) return v;
    }
    if (special === 'super') return new SuperObject(this, frame.thisValue, frame.superHolder);
    if (special === '_global') return this.global;
    return undefined;
  }

  setVariable(frame, name, value) {
    const path = this.#splitPath(frame, name);
    if (path) {
      const [obj, member] = path;
      if (obj && member !== null) {
        obj.set(member, value);
        return;
      }
      if (member === null) return;
    }
    // 内側から探して、その名前を持つスコープに代入する。見つからなければタイムライン（対象クリップ）に作る。
    for (let i = frame.scopes.length - 1; i >= 1; i--) {
      const scope = frame.scopes[i];
      if (scope.target || scope.object.has(name)) {
        scope.object.set(name, value);
        return;
      }
    }
    (frame.target ?? this.global).set(name, value);
  }

  // var 宣言。関数の中ならその呼び出しの局所変数、外ならタイムラインの変数になる。
  #defineLocal(frame, name, value, onlyIfMissing) {
    // with で積んだオブジェクトには作らない（その外側の、関数またはタイムラインに作る）。
    let i = frame.scopes.length - 1;
    while (i > 1 && frame.scopes[i].with) i--;
    const scope = frame.scopes[i].object;
    if (onlyIfMissing && scope.ownHas(name)) return;
    scope.set(name, value);
  }

  // --- 実行 ---

  /**
   * code[start, end) を実行する。return に達したら Return を返す。
   * stack は with や try のブロックと共有する。
   */
  execute(code, start, end, frame, stack) {
    // 実行中のタイムライン。new Color("名前") のように、ネイティブの関数がパスの起点として使う。
    const outer = this.currentTarget;
    this.currentTarget = frame.target;
    try {
      return this.#execute(code, start, end, frame, stack);
    } finally {
      this.currentTarget = outer;
    }
  }

  #execute(code, start, end, frame, stack) {
    const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
    const pop = () => (stack.length ? stack.pop() : undefined);
    const push = (v) => stack.push(v);
    const num = () => toNumber(this, pop());
    const str = () => toStr(this, pop());
    const string = (pos) => {
      let z = pos;
      while (z < end && code[z] !== 0) z++;
      return [this.legacy ? byteString(code.subarray(pos, z)) : decoder.decode(code.subarray(pos, z)), z + 1];
    };
    // 古い命令 (SWF 4) の結果は、SWF 5 以降では真偽値、SWF 4 では 1 / 0。
    const flag = (b) => (this.version >= 5 ? b : b ? 1 : 0);
    const args = () => {
      const n = Math.max(0, Math.min(toInt32(this, pop()), stack.length));
      const list = [];
      for (let i = 0; i < n; i++) list.push(pop());
      return list;
    };
    const clip = () => (frame.target?.isMovieClip ? frame.target : null);

    let pc = start;
    while (pc < end) {
      if (--this.steps < 0) throw new AVMError('script runs too long');
      const op = code[pc++];
      let data = pc;
      let len = 0;
      if (op >= 0x80) {
        if (pc + 2 > end) break;
        len = view.getUint16(pc, true);
        data = pc + 2;
        pc = data + len;
        if (pc > end) break;
      }

      switch (op) {
        case 0x00: return undefined; // End

        // --- タイムライン制御 (SWF 3) ---
        case 0x04: clip()?.nextFrame(); break;
        case 0x05: clip()?.prevFrame(); break;
        case 0x06: clip()?.play(); break;
        case 0x07: clip()?.stop(); break;
        case 0x08: break; // ToggleQuality
        case 0x09: clip()?.clip.movie.sounds.stop(); break; // StopSounds: 鳴っている音をすべて止める
        case 0x81: clip()?.gotoFrame(view.getUint16(data, true) + 1, false); break; // GotoFrame
        case 0x83: { // GetURL: 要求を記録して、移動はホストに任せる。対象がレベル（"_level1" など）なら、そのレベルへの読み込み
          const [url, next] = string(data);
          const req = { kind: 'getURL', url, target: string(next)[0], method: '' };
          const level = /^_level(\d+)$/i.exec(req.target);
          if (level) {
            this.loadMovie({ level: Number(level[1]) }, url, '', clip());
            break;
          }
          this.request(req);
          this.navigate({ ...req, data: '' });
          break;
        }
        case 0x8a: break; // WaitForFrame: 全フレーム読み込み済みなので飛ばさない
        case 0x8b: { // SetTarget
          const [path] = string(data);
          frame = this.#retarget(frame, path === '' ? undefined : this.resolvePath(frame, path) ?? null);
          break;
        }
        case 0x8c: clip()?.gotoFrame(string(data)[0], false); break; // GoToLabel

        // --- スタックと演算 (SWF 4) ---
        case 0x96: { // Push
          let p = data;
          while (p < pc) {
            const type = code[p++];
            if (type === 0) {
              const [s, next] = string(p);
              push(s);
              p = next;
            } else if (type === 1) {
              push(view.getFloat32(p, true));
              p += 4;
            } else if (type === 2) {
              push(null);
            } else if (type === 3) {
              push(undefined);
            } else if (type === 4) {
              push(frame.registers[code[p++]]);
            } else if (type === 5) {
              push(code[p++] !== 0);
            } else if (type === 6) {
              // DOUBLE は上位 4 バイトが先に入っている
              const b = new DataView(new ArrayBuffer(8));
              b.setUint32(4, view.getUint32(p, true), true);
              b.setUint32(0, view.getUint32(p + 4, true), true);
              push(b.getFloat64(0, true));
              p += 8;
            } else if (type === 7) {
              push(view.getInt32(p, true));
              p += 4;
            } else if (type === 8) {
              push(frame.constants[code[p++]]);
            } else if (type === 9) {
              push(frame.constants[view.getUint16(p, true)]);
              p += 2;
            } else {
              break;
            }
          }
          break;
        }
        case 0x17: pop(); break;
        case 0x0a: { const b = num(), a = num(); push(a + b); break; }
        case 0x0b: { const b = num(), a = num(); push(a - b); break; }
        case 0x0c: { const b = num(), a = num(); push(a * b); break; }
        case 0x0d: { // Divide: SWF 4 では 0 除算が "#ERROR#"
          const b = num(), a = num();
          push(b === 0 && this.version < 5 ? '#ERROR#' : a / b);
          break;
        }
        case 0x0e: { const b = num(), a = num(); push(flag(a === b)); break; }
        case 0x0f: { const b = num(), a = num(); push(flag(a < b)); break; }
        case 0x10: { const b = toBool(this, pop()), a = toBool(this, pop()); push(flag(a && b)); break; }
        case 0x11: { const b = toBool(this, pop()), a = toBool(this, pop()); push(flag(a || b)); break; }
        case 0x12: push(flag(!toBool(this, pop()))); break;
        case 0x13: { const b = str(), a = str(); push(flag(a === b)); break; }
        // SWF 5 以前の文字列はバイト列。mb の付かない命令はバイト単位、mb 付きは文字単位で数える。
        case 0x14: push(str().length); break; // StringLength
        case 0x31: { const s = str(); push(this.legacy ? this.legacy.length(s) : s.length); break; } // MBStringLength
        case 0x15: case 0x35: { // StringExtract / MBStringExtract（開始位置は 1 始まり）
          const count = num(), index = num(), s = str();
          const from = Math.max(0, Math.floor(index) - 1);
          if (this.legacy && op === 0x35) push(this.legacy.slice(s, from, Math.floor(count)));
          else {
            const part = count < 0 ? s.slice(from) : s.slice(from, from + Math.floor(count));
            push(this.legacy ? this.legacy.whole(part) : part); // 2 バイト文字の途中で切れた分は捨てられる
          }
          break;
        }
        case 0x18: push(num() | 0); break; // ToInteger: 32 ビット整数にする（int(1e20) は 1661992960）
        case 0x21: { // StringAdd
          const b = str(), a = str();
          if (a.length + b.length > MAX_STRING) throw new AVMError('string is too long');
          push(a + b);
          break;
        }
        case 0x29: { const b = str(), a = str(); push(flag(a < b)); break; }
        case 0x32: push(str().charCodeAt(0) || 0); break; // CharToAscii
        case 0x36: { // MBCharToAscii: 2 バイト文字は (1 バイト目 << 8) | 2 バイト目
          const s = str();
          const two = this.legacy?.lead(s.charCodeAt(0)) && s.length > 1;
          push(two ? (s.charCodeAt(0) << 8) | s.charCodeAt(1) : s.charCodeAt(0) || 0);
          break;
        }
        case 0x33: case 0x37: { // AsciiToChar / MBAsciiToChar
          const n = num();
          if (!this.legacy) push(String.fromCharCode(n & 0xffff));
          else if (op === 0x37 && n > 0xff) push(String.fromCharCode((n >> 8) & 0xff, n & 0xff));
          else push(this.legacy.whole(String.fromCharCode(n & 0xff))); // 2 バイト文字の 1 バイト目だけでは文字にならない
          break;
        }
        case 0x30: { // RandomNumber
          const max = toInt32(this, pop());
          push(max > 0 ? Math.floor(this.random() * max) : 0);
          break;
        }
        case 0x34: push(Math.floor(this.now())); break; // GetTime
        case 0x26: this.trace(this.traceText(pop())); break; // Trace
        case 0x2d: { // FSCommand2（Flash Lite）: 引数の数、コマンド名、引数の順に取り出して、結果を積む
          // デスクトップ版の実機は、この命令を読み飛ばす（スタックにも触らない。実機で確認）。ホストが fscommand2 を渡したときだけ、
          // Flash Lite として実行する。結果が数値でも文字列でもなければ -1（対応していない、の値）。
          if (!this.fscommand2) break;
          const count = Math.min(Math.max(0, toInt32(this, pop())), stack.length);
          const args = [];
          for (let i = 0; i < count; i++) { const v = pop(); args.push(v instanceof AVMObject ? toStr(this, v) : v); }
          const command = toStr(this, args.shift() ?? '');
          const result = this.fscommand2(command, args, { setVariable: (name, value) => this.setVariable(frame, String(name), value) });
          push(typeof result === 'number' || typeof result === 'string' ? result : -1);
          break;
        }

        // --- 分岐 ---
        case 0x99: pc += view.getInt16(data, true); break; // Jump
        case 0x9d: if (toBool(this, pop())) pc += view.getInt16(data, true); break; // If
        case 0x9e: { // Call: 指定フレームのアクションを実行する
          // "パス:フレーム" なら別のクリップのフレーム。その場合はそのクリップを対象にして実行する。
          const spec = pop();
          let t = clip();
          let frameSpec = spec;
          let inner = frame;
          if (typeof spec === 'string' && spec.includes(':')) {
            const at = spec.lastIndexOf(':');
            t = this.resolvePath(frame, spec.slice(0, at));
            frameSpec = spec.slice(at + 1);
            if (t?.isMovieClip) inner = { ...this.#retarget(frame, t), base: undefined };
          }
          if (!t?.isMovieClip) break;
          for (const block of t.frameActions(frameSpec)) this.execute(block, 0, block.length, { ...inner, constants: [] }, []);
          break;
        }

        // --- 変数とプロパティ ---
        case 0x1c: { // GetVariable
          const value = this.getVariable(frame, str());
          // SWF 4 では、クリップの名前を変数として読んでもクリップは得られない。
          push(this.version < 5 && value?.isMovieClip ? undefined : value);
          break;
        }
        case 0x1d: { const value = pop(); this.setVariable(frame, str(), value); break; }
        case 0x20: { // SetTarget2
          const t = pop();
          const target = t instanceof AVMObject ? t : toStr(this, t) === '' ? undefined : this.resolvePath(frame, toStr(this, t)) ?? null;
          frame = this.#retarget(frame, target);
          break;
        }
        case 0x22: { // GetProperty
          const index = toInt32(this, pop());
          const t = this.#targetOf(frame, pop());
          push(t && PROPERTIES[index] ? t.get(PROPERTIES[index]) : undefined);
          break;
        }
        case 0x23: { // SetProperty
          const value = pop();
          const index = toInt32(this, pop());
          const t = this.#targetOf(frame, pop());
          if (t && PROPERTIES[index]) t.set(PROPERTIES[index], value);
          break;
        }
        case 0x24: { // CloneSprite
          const depth = num();
          const name = str();
          this.#targetOf(frame, pop())?.duplicate?.(name, depth);
          break;
        }
        case 0x25: this.#targetOf(frame, pop())?.removeSelf?.(); break; // RemoveSprite
        case 0x27: { // StartDrag
          const t = this.#targetOf(frame, pop());
          const lock = toBool(this, pop());
          let bounds;
          if (toBool(this, pop())) {
            const bottom = num(), right = num(), top = num(), left = num();
            bounds = { left: left * 20, top: top * 20, right: right * 20, bottom: bottom * 20 };
          }
          if (t?.isMovieClip) t.clip.movie.startDrag(t.clip, lock, bounds);
          break;
        }
        case 0x28: clip()?.clip.movie.stopDrag(); break; // EndDrag
        case 0x8d: pop(); break; // WaitForFrame2
        case 0x9a: { // GetURL2: 要求を記録して、移動や変数の読み込みはホストに任せる（ムービーの読み込みは行わない）
          // フラグのビットの並びは、仕様書の表とは逆になっている（実機で確認）: 最上位が「変数を読み込む」、次が「対象がクリップ」、
          // 下位 2 ビットが送るときのメソッド（1: GET、2: POST）。
          const flags = code[data];
          const target = toStr(this, pop());
          const url = toStr(this, pop());
          const toClip = (flags & 0x40) !== 0;
          const kind = flags & 0x80 ? 'loadVariables' : toClip ? 'loadMovie' : 'getURL';
          const req = { kind, url, target, method: ['', 'GET', 'POST'][flags & 3] ?? '' };
          // メソッドの指定があれば、今のクリップの変数を一緒に送る。
          const sent = req.method && clip() ? this.clipVariables(clip()) : '';
          // 対象: クリップのパス。対象がウィンドウの指定（変数の読み込みでは loadVariablesNum の _level<n>）なら、レベルだけを受け付ける。
          const into = toClip || /^_level\d+$/i.test(target) ? (target === '' ? clip() : this.resolvePath(frame, target)) : null;
          if (kind === 'loadVariables') {
            // 読み込んだ "a=1&b=2" を、対象のクリップの変数に入れる。
            this.loadText({ ...req, body: sent }, (text) => { if (text !== undefined && into?.isMovieClip && !into.clip.removed) this.loadedVariables(into, text); });
            break;
          }
          const level = /^_level(\d+)$/i.exec(target);
          if (level) this.loadMovie({ level: Number(level[1]) }, url, req.method, clip()); // loadMovieNum
          else if (kind === 'loadMovie') {
            if (into?.isMovieClip) this.loadMovie({ clip: into }, url, req.method, clip());
            else this.request(req);
          } else {
            this.request(req);
            this.navigate({ ...req, data: sent });
          }
          break;
        }
        case 0x9f: { // GotoFrame2
          const flags = code[data];
          const spec = pop();
          const bias = flags & 2 ? view.getUint16(data + 1, true) : 0;
          let t = clip();
          let frameSpec = spec;
          if (typeof spec === 'string' && spec.includes(':')) {
            const at = spec.lastIndexOf(':');
            t = this.resolvePath(frame, spec.slice(0, at));
            frameSpec = spec.slice(at + 1);
          }
          if (t?.isMovieClip) t.gotoFrame(typeof frameSpec === 'number' ? frameSpec + bias : frameSpec, (flags & 1) !== 0);
          break;
        }

        // --- SWF 5 ---
        case 0x88: { // ConstantPool
          const count = view.getUint16(data, true);
          const pool = [];
          let p = data + 2;
          for (let i = 0; i < count && p < pc; i++) {
            const [s, next] = string(p);
            pool.push(s);
            p = next;
          }
          frame = { ...frame, constants: pool };
          break;
        }
        case 0x87: frame.registers[code[data]] = stack.length ? stack[stack.length - 1] : undefined; break; // StoreRegister
        case 0x4c: push(stack.length ? stack[stack.length - 1] : undefined); break; // PushDuplicate
        case 0x4d: { const b = pop(), a = pop(); push(b); push(a); break; } // StackSwap
        case 0x3c: { const value = pop(); this.#defineLocal(frame, str(), value, false); break; }
        case 0x41: this.#defineLocal(frame, str(), undefined, true); break;
        case 0x4e: { // GetMember
          const name = pop();
          const obj = pop();
          push(this.getMember(obj, toStr(this, name)));
          break;
        }
        case 0x4f: { // SetMember
          const value = pop();
          const name = pop();
          const obj = pop();
          if (obj instanceof AVMObject) obj.set(toStr(this, name), value);
          break;
        }
        case 0x3a: { // Delete
          const name = str();
          const obj = pop();
          push(obj instanceof AVMObject ? obj.delete(name) : false);
          break;
        }
        case 0x3b: { // Delete2: スコープ内の変数を消す
          const name = str();
          let deleted = false;
          for (let i = frame.scopes.length - 1; i >= 1 && !deleted; i--) {
            if (frame.scopes[i].object.ownHas(name)) deleted = frame.scopes[i].object.delete(name);
          }
          push(deleted);
          break;
        }
        case 0x3d: { // CallFunction
          const name = str();
          const list = args();
          // 関数が見つかったスコープがムービークリップなら、それが this になる。
          let fn;
          let thisValue;
          for (let i = frame.scopes.length - 1; i >= 0 && fn === undefined; i--) {
            const scope = frame.scopes[i].object;
            if (scope.has(name)) {
              fn = scope.get(name);
              if (scope.isMovieClip) thisValue = scope;
            }
          }
          if (fn === undefined) fn = this.getVariable(frame, name);
          push(this.call(fn, thisValue, list));
          break;
        }
        case 0x52: { // CallMethod
          const name = pop();
          const obj = pop();
          const list = args();
          push(this.#callMethod(obj, name, list));
          break;
        }
        case 0x40: { const name = str(); push(this.construct(this.getVariable(frame, name), args())); break; } // NewObject
        case 0x53: { // NewMethod
          const name = pop();
          const obj = pop();
          const list = args();
          const fn = name === undefined || name === '' ? obj : this.getMember(obj, toStr(this, name));
          push(this.construct(fn, list));
          break;
        }
        case 0x3e: return new Return(pop());
        case 0x42: { // InitArray
          push(new AVMArray(this, args()));
          break;
        }
        case 0x43: { // InitObject
          const n = Math.max(0, Math.min(toInt32(this, pop()), stack.length >> 1));
          const obj = new AVMObject(this, this.objectProto);
          for (let i = 0; i < n; i++) {
            const value = pop();
            obj.set(str(), value);
          }
          push(obj);
          break;
        }
        case 0x44: push(typeOf(pop())); break;
        case 0x45: { const t = pop(); push(t?.isMovieClip || t?.isVideo ? t.targetPath() : undefined); break; }
        case 0x46: case 0x55: { // Enumerate / Enumerate2
          const obj = op === 0x46 ? this.getVariable(frame, str()) : pop();
          push(undefined);
          if (obj instanceof AVMObject) {
            const names = obj.enumerate();
            for (let i = names.length - 1; i >= 0; i--) push(names[i]); // 取り出す順が列挙の順になるよう逆に積む
          }
          break;
        }
        case 0x47: { // Add2: どちらかが文字列なら連結
          const b = toPrimitive(this, pop());
          const a = toPrimitive(this, pop());
          if (typeof a === 'string' || typeof b === 'string') {
            const s = toStr(this, a) + toStr(this, b);
            if (s.length > MAX_STRING) throw new AVMError('string is too long');
            push(s);
          } else {
            push(toNumber(this, a) + toNumber(this, b));
          }
          break;
        }
        case 0x48: { const b = pop(), a = pop(); push(lessThan(this, a, b)); break; }
        case 0x67: { const b = pop(), a = pop(); push(lessThan(this, b, a)); break; } // Greater
        case 0x68: { const b = str(), a = str(); push(a > b); break; } // StringGreater
        case 0x49: { const b = pop(), a = pop(); push(looseEquals(this, a, b)); break; }
        case 0x66: { // StrictEquals（NaN === NaN も真）
          const b = pop(), a = pop();
          push(typeOf(a) === typeOf(b) && (a === b || (typeof a === 'number' && Number.isNaN(a) && Number.isNaN(b))));
          break;
        }
        case 0x4a: push(num()); break;
        case 0x4b: push(str()); break;
        case 0x3f: { const b = num(), a = num(); push(a % b); break; }
        case 0x50: push(num() + 1); break;
        case 0x51: push(num() - 1); break;
        case 0x60: { const b = toInt32(this, pop()), a = toInt32(this, pop()); push(a & b); break; }
        case 0x61: { const b = toInt32(this, pop()), a = toInt32(this, pop()); push(a | b); break; }
        case 0x62: { const b = toInt32(this, pop()), a = toInt32(this, pop()); push(a ^ b); break; }
        case 0x63: { const b = toInt32(this, pop()), a = toInt32(this, pop()); push(a << (b & 31)); break; }
        case 0x64: { const b = toInt32(this, pop()), a = toInt32(this, pop()); push(a >> (b & 31)); break; }
        case 0x65: { const b = toInt32(this, pop()), a = toInt32(this, pop()); push((a >>> (b & 31)) | 0); break; } // 結果は符号付き 32 ビット
        case 0x94: { // With
          const size = view.getUint16(data, true);
          const obj = pop();
          const blockEnd = Math.min(end, pc + size);
          if (obj instanceof AVMObject) {
            const done = this.execute(code, pc, blockEnd, { ...frame, scopes: [...frame.scopes, { object: obj, with: true }] }, stack);
            if (done) return done;
          }
          pc = blockEnd;
          break;
        }
        case 0x9b: case 0x8e: { // DefineFunction / DefineFunction2
          const function2 = op === 0x8e;
          let [name, p] = string(data);
          const count = view.getUint16(p, true);
          p += 2;
          let registerCount = 0;
          let flags = 0;
          if (function2) {
            registerCount = code[p];
            flags = view.getUint16(p + 1, true);
            p += 3;
          }
          const params = [];
          for (let i = 0; i < count && p < pc; i++) {
            const register = function2 ? code[p++] : 0;
            const [pname, next] = string(p);
            params.push({ name: pname, register });
            p = next;
          }
          const size = view.getUint16(p, true);
          const bodyEnd = Math.min(end, pc + size);
          const fn = new AVMFunction(this, {
            script: {
              code, start: pc, end: bodyEnd, params, function2, registerCount, flags,
              scopes: frame.scopes, target: frame.scopes.find((s) => s.target)?.object ?? frame.target, constants: frame.constants,
            },
          });
          const proto = new AVMObject(this, this.objectProto);
          proto.define('constructor', fn, DONT_ENUM);
          fn.define('prototype', proto, DONT_ENUM);
          pc = bodyEnd;
          if (name === '') push(fn);
          else frame.scopes[frame.scopes.length - 1].object.set(name, fn);
          break;
        }

        // --- SWF 6〜7 ---
        case 0x54: { const ctor = pop(), obj = pop(); push(this.instanceOf(obj, ctor)); break; }
        case 0x2b: { const obj = pop(), ctor = pop(); push(this.instanceOf(obj, ctor) ? obj : null); break; } // CastOp
        case 0x2c: { // ImplementsOp
          const ctor = pop();
          const list = args();
          const proto = ctor instanceof AVMObject ? ctor.get('prototype') : undefined;
          if (proto instanceof AVMObject) proto.interfaces = list.filter((it) => it instanceof AVMFunction);
          break;
        }
        case 0x69: { // Extends
          const superclass = pop();
          const subclass = pop();
          if (subclass instanceof AVMObject && superclass instanceof AVMObject) {
            const sp = superclass.get('prototype');
            const proto = new AVMObject(this, sp instanceof AVMObject ? sp : null);
            proto.define('constructor', superclass, DONT_ENUM);
            proto.define('__constructor__', superclass, DONT_ENUM);
            subclass.set('prototype', proto);
          }
          break;
        }
        case 0x2a: throw new Thrown(pop());
        case 0x8f: { // Try
          const flags = code[data];
          const trySize = view.getUint16(data + 1, true);
          const catchSize = view.getUint16(data + 3, true);
          const finallySize = view.getUint16(data + 5, true);
          const catchRegister = flags & 4 ? code[data + 7] : -1;
          const catchName = flags & 4 ? '' : string(data + 7)[0];
          const tryEnd = Math.min(end, pc + trySize);
          const catchEnd = Math.min(end, tryEnd + catchSize);
          const finallyEnd = Math.min(end, catchEnd + finallySize);
          let done;
          let pending;
          try {
            done = this.execute(code, pc, tryEnd, frame, stack);
          } catch (e) {
            if (!(e instanceof Thrown)) throw e;
            if (flags & 1) {
              if (catchRegister >= 0) frame.registers[catchRegister] = e.value;
              else this.#defineLocal(frame, catchName, e.value, false);
              try {
                done = this.execute(code, tryEnd, catchEnd, frame, stack);
              } catch (e2) {
                if (!(e2 instanceof Thrown)) throw e2;
                pending = e2;
              }
            } else {
              pending = e;
            }
          }
          if (flags & 2) {
            const fin = this.execute(code, catchEnd, finallyEnd, frame, stack);
            if (fin) return fin;
          }
          if (pending) throw pending;
          if (done) return done;
          pc = finallyEnd;
          break;
        }

        default: break; // 未知の命令は読み飛ばす
      }
      if (pc < start || pc > end) break; // 範囲外へのジャンプは実行終了
    }
    return undefined;
  }

  /** trace() が出力する文字列。undefined は常に "undefined"。 */
  traceText(v) {
    return v === undefined ? 'undefined' : toStr(this, v);
  }

  // tellTarget: 以降の命令の対象を target に切り替える。変数の検索先（タイムライン）も target に替わる。
  // target が undefined なら元に戻す。null（存在しないパス）なら、対象なしで元のスコープのまま。
  #retarget(frame, target) {
    const base = frame.base ?? { target: frame.target, scopes: frame.scopes };
    if (target === undefined) return { ...frame, target: base.target, scopes: base.scopes, base: undefined };
    const scopes = target ? base.scopes.map((s) => (s.target ? { object: target, target: true } : s)) : base.scopes;
    return { ...frame, target, scopes, base };
  }

  // GetProperty などの対象: 値がオブジェクトならそれ、空文字なら現在の対象、文字列ならパスとして解決する。
  #targetOf(frame, t) {
    if (t instanceof AVMObject) return t;
    const path = toStr(this, t);
    return path === '' ? frame.target : this.resolvePath(frame, path);
  }

  #callMethod(obj, name, list) {
    if (obj instanceof SuperObject) {
      if (name === undefined || name === '') {
        // super(...): 親クラスのコンストラクタを、this はそのままで呼ぶ
        const holder = obj.holder;
        return this.call(holder?.get('__constructor__'), obj.thisObj, list, holder?.proto ?? null);
      }
      const base = obj.holder?.proto;
      const key = toStr(this, name);
      return base ? this.call(base.get(key), obj.thisObj, list, base.holderOf(key)) : undefined;
    }
    if (name === undefined || name === '') return this.call(obj, undefined, list);
    const key = toStr(this, name);
    const fn = this.getMember(obj, key);
    const holder = obj instanceof AVMObject ? obj.holderOf(key) : null;
    return this.call(fn, obj, list, holder);
  }
}

