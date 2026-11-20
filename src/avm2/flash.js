// flash.* の組み込みクラスと、表示リスト（player/movie.js）との橋渡し。
//
// AS3 のオブジェクト obj と、プレイヤーの表示オブジェクト d は 1 対 1 で結び付く（obj.display === d、d.as3 === obj）。
// 位置やフレームなどの状態はプレイヤー側が持ち、ここのクラスはそれを読み書きするだけ。
import { gradientStyle, lineOptions } from '../player/drawing.js';
import { installBitmap } from './bitmap.js';
import { installBytes } from './bytes.js';
import { installDisplayExtras } from './displayext.js';
import { installFilters } from './filters.js';
import { installGeom } from './geom.js';
import { installGeom3D } from './geom3d.js';
import { installMedia } from './media.js';
import { installNet } from './net.js';
import { installStdlib } from './stdlib.js';
import { installText } from './text.js';
import { installXMLDocument } from './xmldoc.js';
import { installVideo } from './video.js';
import { ASArray, ASClass, ASFunction, ASObject, ASThrown, ASVector, publicKey } from './object.js';
import { installUtils } from './utils.js';

const DEG = 180 / Math.PI;

/**
 * @param {import('./vm.js').AVM2} vm
 * @param {import('../player/movie.js').Movie} movie
 * @param {{ MovieClip: Function, TextField: Function }} types  プレイヤーの表示オブジェクトのクラス
 */
export function installFlash(vm, movie, types) {
  const c = vm.classes;
  const str = (v) => vm.toStr(v);
  const num = (v) => vm.toNumber(v);
  const publicName = (name) => ({ name, keys: [publicKey(name)], late: true });
  const display = (vm.display = { stage: null, frameListeners: new Set() });
  // ハンドラやコンストラクタの中で捕まえられなかった例外は、警告として残す（実機のデバッガ版は、その内容をログに書く）。
  const report = (text) => movie.warn(`uncaught error: ${text}`);

  installUtils(vm);
  installBytes(vm, movie);

  // --- イベント ---
  c.Event = vm.defineClass({
    name: 'flash.events::Event',
    // 状態は入れ物を作るときに用意する（派生クラスが super() より前にメソッドを呼んでも壊れないように）。
    allocate: (klass) => Object.assign(new ASObject(klass), { event: { type: '', bubbles: false, cancelable: false, target: null, currentTarget: null, phase: 2, stopped: false, prevented: false } }),
    construct: (self, [type, bubbles, cancelable]) => {
      Object.assign(self.event, { type: str(type), bubbles: vm.toBoolean(bubbles), cancelable: vm.toBoolean(cancelable) });
    },
    getters: {
      type: (self) => self.event.type, bubbles: (self) => self.event.bubbles, cancelable: (self) => self.event.cancelable,
      target: (self) => self.event.target, currentTarget: (self) => self.event.currentTarget, eventPhase: (self) => self.event.phase,
    },
    methods: {
      stopPropagation: (self) => { self.event.stopped = true; },
      stopImmediatePropagation: (self) => { self.event.stopped = self.event.stoppedNow = true; },
      preventDefault: (self) => { if (self.event.cancelable) self.event.prevented = true; },
      isDefaultPrevented: (self) => self.event.prevented,
      clone: (self) => vm.construct(self.klass, [self.event.type, self.event.bubbles, self.event.cancelable]),
      toString: (self) => `[${self.klass.shortName} type="${self.event.type}" bubbles=${self.event.bubbles} cancelable=${self.event.cancelable} eventPhase=${self.event.phase}]`,
      // 派生のイベントの toString 用: formatToString("クラス名", "type", "bubbles", ...) が、[クラス名 type="…" bubbles=… …] を返す。
      formatToString: (self, [className, ...names]) => formatEvent(self, str(className), names.map(str)),
    },
    staticValues: {
      ENTER_FRAME: 'enterFrame', EXIT_FRAME: 'exitFrame', FRAME_CONSTRUCTED: 'frameConstructed', ADDED: 'added', ADDED_TO_STAGE: 'addedToStage',
      REMOVED: 'removed', REMOVED_FROM_STAGE: 'removedFromStage', COMPLETE: 'complete', INIT: 'init', OPEN: 'open', CLOSE: 'close', CHANGE: 'change',
      RESIZE: 'resize', ACTIVATE: 'activate', DEACTIVATE: 'deactivate', RENDER: 'render', SOUND_COMPLETE: 'soundComplete', UNLOAD: 'unload', CANCEL: 'cancel',
      SELECT: 'select', SCROLL: 'scroll', MOUSE_LEAVE: 'mouseLeave', TAB_CHILDREN_CHANGE: 'tabChildrenChange', ID3: 'id3',
      TAB_ENABLED_CHANGE: 'tabEnabledChange', TAB_INDEX_CHANGE: 'tabIndexChange', FULLSCREEN: 'fullScreen', CONNECT: 'connect', CLEAR: 'clear', COPY: 'copy',
      CUT: 'cut', PASTE: 'paste', SELECT_ALL: 'selectAll', CLOSING: 'closing', FRAME_LABEL: 'frameLabel', CLOUD_CHANGE: 'cloudChange', SUSPEND: 'suspend',
      TEXT_INTERACTION_MODE_CHANGE: 'textInteractionModeChange', VIDEO_FRAME: 'videoFrame', CHANNEL_MESSAGE: 'channelMessage', CHANNEL_STATE: 'channelState',
      WORKER_STATE: 'workerState', USER_IDLE: 'userIdle', USER_PRESENT: 'userPresent', NETWORK_CHANGE: 'networkChange', EXITING: 'exiting', DISPLAYING: 'displaying',
      HTML_BOUNDS_CHANGE: 'htmlBoundsChange', HTML_DOM_INITIALIZE: 'htmlDOMInitialize', HTML_RENDER: 'htmlRender', LOCATION_CHANGE: 'locationChange',
      SCROLL_BOUNDS_CHANGE: 'scrollBoundsChange',
    },
  });
  // [クラス名 項目=値 …]。文字列は引用符で囲み、それ以外は文字列にして出す（実機の Event.formatToString と同じ形）。
  const formatEvent = (self, className, names) => {
    const base = { type: self.event.type, bubbles: self.event.bubbles, cancelable: self.event.cancelable, eventPhase: self.event.phase };
    return `[${className} ${names.map((name) => {
      const v = name in base ? base[name] : self.event[name];
      return `${name}=${typeof v === 'string' ? `"${v}"` : str(v === undefined ? null : v)}`;
    }).join(' ')}]`;
  };
  // 派生のイベント。fields は、コンストラクタの 4 番目以降の引数に対応する項目と、その既定値・変換（読み取り用のプロパティにもなる）。
  const eventClass = (name, fields, constants, defaultBubbles = false, base = c.Event, shown = null) => {
    const klass = vm.defineClass({
      name: `flash.events::${name}`, base,
      construct: (self, [type, bubbles = defaultBubbles, cancelable, ...rest]) => {
        vm.call(c.Event.constructorFn, self, [type, bubbles, cancelable]);
        fields.forEach(([key, initial, convert], i) => { self.event[key] = rest[i] === undefined ? initial : convert(rest[i]); });
      },
      methods: {
        clone: (self) => vm.construct(self.klass, [self.event.type, self.event.bubbles, self.event.cancelable, ...fields.map(([key]) => self.event[key])]),
        ...(shown ? { toString: (self) => formatEvent(self, name, ['type', 'bubbles', 'cancelable', 'eventPhase', ...shown]) } : {}),
      },
      staticValues: constants,
    });
    for (const [key, , convert] of fields) {
      klass.instanceTraits.set(publicKey(key), {
        kind: 'accessor', key: publicKey(key), name: key,
        get: vm.native((self) => self.event[key]), set: vm.native((self, [v]) => { self.event[key] = convert(v); }),
      });
    }
    return klass;
  };
  const bool = (v) => vm.toBoolean(v);
  const same = (v) => v;
  c.MouseEvent = eventClass('MouseEvent', [
    ['localX', NaN, num], ['localY', NaN, num], ['relatedObject', null, same], ['ctrlKey', false, bool], ['altKey', false, bool], ['shiftKey', false, bool],
    ['buttonDown', false, bool], ['delta', 0, (v) => vm.toInt32(v)],
  ], {
    CLICK: 'click', DOUBLE_CLICK: 'doubleClick', MOUSE_DOWN: 'mouseDown', MOUSE_UP: 'mouseUp', MOUSE_MOVE: 'mouseMove', MOUSE_OVER: 'mouseOver',
    MOUSE_OUT: 'mouseOut', ROLL_OVER: 'rollOver', ROLL_OUT: 'rollOut', MOUSE_WHEEL: 'mouseWheel',
  }, true);
  // stageX / stageY は、target の座標系の localX / localY をステージの座標に直したもの。
  for (const [key, axis] of [['stageX', 'x'], ['stageY', 'y']]) {
    c.MouseEvent.instanceTraits.set(publicKey(key), {
      kind: 'accessor', key: publicKey(key), name: key, set: null,
      get: vm.native((self) => {
        const e = self.event;
        const d = e.target?.display;
        if (!d?.worldMatrix || Number.isNaN(e.localX) || Number.isNaN(e.localY)) return axis === 'x' ? e.localX : e.localY;
        const m = d.worldMatrix();
        return axis === 'x' ? (m.a * e.localX * 20 + m.c * e.localY * 20 + m.tx) / 20 : (m.b * e.localX * 20 + m.d * e.localY * 20 + m.ty) / 20;
      }),
    });
  }
  c.KeyboardEvent = eventClass('KeyboardEvent', [
    ['charCode', 0, (v) => vm.toUint32(v)], ['keyCode', 0, (v) => vm.toUint32(v)], ['keyLocation', 0, (v) => vm.toUint32(v)],
    ['ctrlKey', false, bool], ['altKey', false, bool], ['shiftKey', false, bool],
  ], { KEY_DOWN: 'keyDown', KEY_UP: 'keyUp' }, true);
  c.TimerEvent = eventClass('TimerEvent', [], { TIMER: 'timer', TIMER_COMPLETE: 'timerComplete' });
  // 読み込みや通信にかかわるイベント（外部の読み込みはしないので、届くのは失敗の通知だけ）。
  const text = [['text', '', str]];
  const errorFields = [['text', '', str], ['errorID', 0, (v) => vm.toInt32(v)]];
  c.TextEvent = eventClass('TextEvent', text, { LINK: 'link', TEXT_INPUT: 'textInput' });
  c.ErrorEvent = eventClass('ErrorEvent', errorFields, { ERROR: 'error' }, false, c.TextEvent);
  c.IOErrorEvent = eventClass('IOErrorEvent', errorFields, { IO_ERROR: 'ioError' }, false, c.ErrorEvent);
  c.SecurityErrorEvent = eventClass('SecurityErrorEvent', errorFields, { SECURITY_ERROR: 'securityError' }, false, c.ErrorEvent);
  c.ProgressEvent = eventClass('ProgressEvent', [['bytesLoaded', 0, num], ['bytesTotal', 0, num]], { PROGRESS: 'progress', SOCKET_DATA: 'socketData' });
  c.HTTPStatusEvent = eventClass('HTTPStatusEvent', [['status', 0, (v) => vm.toInt32(v)]], { HTTP_STATUS: 'httpStatus' });
  c.NetStatusEvent = eventClass('NetStatusEvent', [['info', null, same]], { NET_STATUS: 'netStatus' });
  c.FocusEvent = eventClass('FocusEvent', [['relatedObject', null, same], ['shiftKey', false, bool], ['keyCode', 0, (v) => vm.toUint32(v)], ['direction', 'none', str]],
    { FOCUS_IN: 'focusIn', FOCUS_OUT: 'focusOut', KEY_FOCUS_CHANGE: 'keyFocusChange', MOUSE_FOCUS_CHANGE: 'mouseFocusChange' }, true, c.Event, ['relatedObject', 'shiftKey', 'keyCode']);
  c.FocusEvent.instanceTraits.set(publicKey('isRelatedObjectInaccessible'), { kind: 'accessor', key: publicKey('isRelatedObjectInaccessible'), name: 'isRelatedObjectInaccessible', get: vm.native(() => false), set: vm.native(() => {}) });
  c.StatusEvent = eventClass('StatusEvent', [['code', '', str], ['level', '', str]], { STATUS: 'status' }, false, c.Event, ['code', 'level']);
  c.FullScreenEvent = eventClass('FullScreenEvent', [['fullScreen', false, bool], ['interactive', false, bool]], { FULL_SCREEN: 'fullScreen' }, false, c.Event, ['fullScreen', 'interactive']);
  c.DataEvent = eventClass('DataEvent', [['data', '', str]], { DATA: 'data', UPLOAD_COMPLETE_DATA: 'uploadCompleteData' }, false, c.Event, ['data']);
  c.ContextMenuEvent = eventClass('ContextMenuEvent', [['mouseTarget', null, same], ['contextMenuOwner', null, same]], { MENU_ITEM_SELECT: 'menuItemSelect', MENU_SELECT: 'menuSelect' }, false, c.Event, ['mouseTarget', 'contextMenuOwner']);
  c.UncaughtErrorEvent = eventClass('UncaughtErrorEvent', [['error', null, same]], { UNCAUGHT_ERROR: 'uncaughtError' }, true, c.Event, ['error']);
  c.AsyncErrorEvent = eventClass('AsyncErrorEvent', [['text', '', str], ['error', null, same]], { ASYNC_ERROR: 'asyncError' }, false, c.ErrorEvent);

  // current に登録されたリスナーのうち、段階 phase（1: キャプチャ、2: ターゲット、3: バブリング）で呼ぶものを呼ぶ。
  // リスナーの中の例外は、ほかのリスナーや dispatchEvent の呼び出し元には伝わらない。
  const deliver = (event, current, phase) => {
    const list = current.listeners?.get(event.event.type);
    if (!list) return;
    for (const entry of list.slice()) {
      if (entry.capture !== (phase === 1)) continue;
      event.event.currentTarget = current;
      event.event.phase = phase;
      vm.run(() => vm.call(entry.fn, null, [event]), report);
      if (event.event.stoppedNow) break;
    }
  };
  // 表示リスト上のオブジェクトへのイベントは、ステージから親までを下り（キャプチャ）、target で呼ばれ、bubbles なら親からステージへ上る。
  const dispatch = (target, event) => {
    if (!(event instanceof ASObject) || !event.event) vm.throwError('TypeError', 2007, 'Parameter event must be non-null.');
    const e = event.event;
    e.target = target;
    const path = [];
    if (target.display && target !== display.stage) {
      for (let d = target.display.parent; d; d = d.parent) if (d.as3) path.push(d.as3);
      if (onStage(target.display) && path[path.length - 1] !== display.stage) path.push(display.stage); // ルートの parent は null にしてある
    }
    for (let i = path.length - 1; i >= 0 && !e.stopped; i--) deliver(event, path[i], 1);
    if (!e.stopped) deliver(event, target, 2);
    if (e.bubbles) for (let i = 0; i < path.length && !e.stopped; i++) deliver(event, path[i], 3);
    return !e.prevented;
  };
  display.dispatch = dispatch;
  display.send = (target, klass, args) => send(target, klass, args);
  display.later = (fn) => addTimer(1000 / movie.frameRate + 0.01, true, fn); // 1 フレームぶんの時間が過ぎた後で fn を呼ぶ
  // プレイヤーが起こすイベントを作って届ける。
  const send = (target, klass, args, fill) => vm.run(() => {
    const event = vm.construct(klass, args);
    fill?.(event.event);
    dispatch(target, event);
  }, report);

  /** フレームごとのイベント（enterFrame など）を、それを聞いている全オブジェクトへ配る。表示リストに載っていなくても届く。 */
  display.broadcast = (type) => {
    for (const obj of [...display.frameListeners]) if (obj.listeners?.get(type)?.length) send(obj, c.Event, [type]);
  };

  // --- マウスとキー ---
  let over = null; // マウスが乗っているオブジェクト（ステージの外にあれば null）
  let pressed = null; // ボタンを押したときに乗っていたオブジェクト
  // obj と、その親たち（内側から。ステージは含めない）。
  const lineage = (obj) => { const list = []; for (let d = obj?.display; d; d = d.parent) if (d.as3 && d.as3 !== display.stage) list.push(d.as3); return list; };
  /**
   * マウスの動きを伝える。d はマウスの位置にあるいちばん手前のオブジェクト（無ければステージが相手）、
   * type は 'mouseMove' / 'mouseDown' / 'mouseUp'（null なら、乗っているものの変化だけ）。
   */
  display.mouse = (type, d, inside, down) => {
    const target = !inside ? null : d ? display.wrap(d) : display.stage;
    const fire = (to, kind, bubbles, related) => heard(to.display, kind) && send(to, c.MouseEvent, [kind, bubbles], (e) => {
      const p = to.display.globalToLocal(movie.mouse.x, movie.mouse.y);
      e.localX = p.x / 20;
      e.localY = p.y / 20;
      e.buttonDown = down;
      e.relatedObject = related === display.stage ? null : related ?? null;
    });
    // 乗っているものが変わったとき。順序は mouseOut → rollOut → rollOver → mouseOver で、rollOut / rollOver は
    // 出入りしたオブジェクトのそれぞれに、内側から届く。ステージ自身には、どれも届かない（実機で確認）。
    if (target !== over) {
      const before = lineage(over);
      const after = lineage(target);
      const old = over;
      over = target;
      if (before.length) {
        fire(old, 'mouseOut', true, target);
        for (const obj of before) if (!after.includes(obj)) fire(obj, 'rollOut', false, target);
      }
      if (after.length) {
        for (const obj of after) if (!before.includes(obj)) fire(obj, 'rollOver', false, old);
        fire(target, 'mouseOver', true, old);
      }
    }
    if (target && type) {
      fire(target, type, true);
      if (type === 'mouseDown') pressed = target;
      if (type === 'mouseUp') {
        if (pressed === target) fire(target, 'click', true);
        pressed = null;
      }
    }
    // スクリプトが作ったボタン（new SimpleButton）の見た目: 乗っていれば over、その上で押していれば down、それ以外は up。
    // タイムラインに置かれたボタンの見た目は、プレイヤー側（movie.js）が切り替える。
    const button = target?.display?.states && target.display.enabled !== false ? target.display : null;
    if (lit && lit !== button) showState(lit, 'up');
    if (button) showState(button, down && pressed === target ? 'down' : 'over');
    lit = button;
  };
  let lit = null; // 見た目が up 以外になっているボタン
  // ボタンの表示オブジェクト d の見た目を state にする（その状態の表示オブジェクトだけを子にする）。
  const showState = (d, state = d.buttonState) => {
    d.buttonState = state;
    const want = d.states[state];
    for (const child of d.sortedChildren()) if (child !== want) d.detachChild(child);
    // 状態の表示オブジェクトが、ほかのところ（addChild された先）にあるなら、取り戻さない（そのボタンには何も表示されない。実機で確認）。
    if (want && !want.parent) d.insertChild(want);
  };
  /** キーの押し下げ・解放を伝える。相手はフォーカスを持つもの（無ければステージ）。mods は { shift, ctrl, alt }。 */
  display.key = (type, keyCode, charCode, mods = {}) => send(movie.focus ? display.wrap(movie.focus) : display.stage, c.KeyboardEvent, [type, true, false, charCode, keyCode, 0, !!mods.ctrl, !!mods.alt, !!mods.shift]);
  /** フォーカスの移動。順序は focusOut（相手は新しいもの）→ focusIn（相手は古いもの）。どちらも親へ伝わる（実機で確認）。 */
  display.focusChange = (old, now) => {
    if (old) send(display.wrap(old), c.FocusEvent, ['focusOut', true, false, now ? display.wrap(now) : null]);
    if (now) send(display.wrap(now), c.FocusEvent, ['focusIn', true, false, old ? display.wrap(old) : null]);
  };
  /** テキストフィールドへ文字が入る直前の textInput（取り消せる）。取り消されなければ true。 */
  display.textInput = (field, text) => {
    let allowed = true;
    vm.run(() => {
      const event = vm.construct(c.TextEvent, ['textInput', true, true, text]);
      allowed = dispatch(display.wrap(field), event);
    }, report);
    return allowed;
  };
  display.change = (field) => send(display.wrap(field), c.Event, ['change', true]);
  display.scroll = (field) => send(display.wrap(field), c.Event, ['scroll']);
  /** マウスが、手の形のカーソルを出すもの（buttonMode のスプライト）の上にあるか。 */
  display.handCursor = () => (!!over?.display?.buttonMode || (!!over?.display?.states && over.display.enabled !== false)) && over.display.useHandCursor !== false;

  // --- タイマー ---
  const timers = new Map(); // id → { next, interval, once, fire }
  let timerCount = 0;
  const addTimer = (interval, once, fire) => {
    if (timers.size >= 10000) return 0;
    const delay = Math.max(0, Number.isFinite(interval) ? interval : 0);
    timers.set(++timerCount, { id: timerCount, next: vm.now() + delay, interval: delay, once, fire });
    return timerCount;
  };
  /** 期限の来たタイマーを、期限の早い順に実行する。1 回の呼び出しでは maxFires 回まで（追いつけないぶんは捨てる）。 */
  display.runTimers = (maxFires = 100) => {
    const now = vm.now();
    for (let fired = 0; fired < maxFires; fired++) {
      let due = null;
      for (const t of timers.values()) if (t.next <= now && (!due || t.next < due.next)) due = t;
      if (!due) return;
      if (due.once) timers.delete(due.id);
      else due.next += due.interval;
      vm.run(due.fire, report);
    }
    for (const t of timers.values()) if (t.next <= now) t.next = now + t.interval;
  };
  for (const [name, once] of [['setTimeout', true], ['setInterval', false]]) {
    vm.defineGlobal(`flash.utils::${name}`, vm.native((_, [fn, delay, ...args]) => {
      if (!(fn instanceof ASFunction)) vm.throwError('TypeError', 2007, 'Parameter closure must be non-null.');
      return addTimer(num(delay), once, () => vm.call(fn, null, args));
    }, name));
  }
  for (const name of ['clearTimeout', 'clearInterval']) vm.defineGlobal(`flash.utils::${name}`, vm.native((_, [id]) => { timers.delete(vm.toUint32(id)); }, name));
  const FRAME_EVENTS = new Set(['enterFrame', 'exitFrame', 'frameConstructed']);
  c.IEventDispatcher = vm.defineClass({ name: 'flash.events::IEventDispatcher', base: null, isInterface: true });
  c.EventDispatcher = vm.defineClass({
    name: 'flash.events::EventDispatcher', interfaces: [c.IEventDispatcher],
    methods: {
      addEventListener: (self, [type, fn, useCapture, priority]) => {
        if (!(fn instanceof ASFunction)) return;
        const list = (self.listeners ??= new Map());
        const key = str(type);
        const entries = list.get(key) ?? [];
        const capture = vm.toBoolean(useCapture);
        if (entries.some((e) => e.capture === capture && vm.equals(e.fn, fn))) return;
        if (entries.length >= 1000) return;
        vm.charge(1);
        entries.push({ fn, capture, priority: vm.toInt32(priority) });
        entries.sort((a, b) => b.priority - a.priority);
        list.set(key, entries);
        if (FRAME_EVENTS.has(key)) display.frameListeners.add(self);
      },
      removeEventListener: (self, [type, fn, useCapture]) => {
        const entries = self.listeners?.get(str(type));
        if (!entries) return;
        const at = entries.findIndex((e) => e.capture === vm.toBoolean(useCapture) && vm.equals(e.fn, fn));
        if (at >= 0) entries.splice(at, 1);
        if (![...FRAME_EVENTS].some((key) => self.listeners.get(key)?.length)) display.frameListeners.delete(self);
      },
      hasEventListener: (self, [type]) => (self.listeners?.get(str(type))?.length ?? 0) > 0,
      willTrigger: (self, [type]) => (self.listeners?.get(str(type))?.length ?? 0) > 0,
      dispatchEvent: (self, [event]) => dispatch(self, event),
    },
  });

  // --- 表示オブジェクト ---
  const D = (self) => self.display; // プレイヤー側の表示オブジェクト
  // いちばん上の親。ルート（キャラクタ ID 0 のタイムライン）なら、ステージに載っている。作っている最中のルートも含む。
  const topOf = (d) => { let top = d; while (top.parent) top = top.parent; return top; };
  const onStage = (d) => { const top = topOf(d); return movie.root ? top === movie.root || top === movie.stage : top.character?.id === 0; };
  // Loader で読み込んだ SWF のルート（loadedInfo を持つ）のうち、d を含むいちばん近いもの。無ければ null。
  const loadedRootOf = (d) => {
    for (let at = d, n = 0; at && n < 1000; at = at.parent, n++) if (at.loadedInfo) return at;
    return null;
  };
  // new で作られたオブジェクトの入れ物。クラス（か、その継承元）に結び付いたスプライトがあれば、その中身を持つクリップになる。
  // 子はここで作られ、そのコンストラクタが先に動く。表示リストに載るまで、タイムラインは進まない。
  // display.nextCharacter があれば、次に作るオブジェクトの中身をそのキャラクタにする（Loader が、読み込んだ SWF のルートを作るときに使う）。
  // display.nextLoadedInfo は、そのオブジェクトの loaderInfo（読み込んだ SWF のルートは、コンストラクタの中から root や loaderInfo が見える）。
  display.nextCharacter = null;
  display.nextLoadedInfo = null;
  const allocate = (klass) => {
    vm.charge(16);
    const obj = new ASObject(klass);
    let character = display.nextCharacter;
    const loadedInfo = display.nextLoadedInfo;
    display.nextCharacter = null;
    display.nextLoadedInfo = null;
    for (let k = klass; k && !character; k = k.superClass) character = movie.linkedCharacter(k.name);
    const d = new types.MovieClip(movie, character?.type === 'sprite' ? character : movie.emptySprite, undefined, undefined, 0, null, obj, loadedInfo);
    d.leaf = klass.isSubclassOf(c.Shape); // 図形は、子を持たず、マウスにも反応しない
    if (d.character === movie.emptySprite) d.currentFrame = 0; // 中身の無いクリップの currentFrame は 0（totalFrames は 1）
    movie.constructPending(d);
    return obj;
  };
  // 行列を拡大率と回転に分ける（AVM1 の _xscale などと同じ考え方）。
  const xform = (d) => {
    if (!d.xform) {
      const m = d.matrix;
      // 回転も傾きも無ければ、拡大率は行列の成分そのもの（負にもなる）。それ以外で裏返っている（行列式が負の）ときは、
      // 縦の拡大率が負になる（どちらも実機で確認）。
      const flip = m.a * m.d - m.b * m.c < 0 ? -1 : 1;
      d.xform = m.b === 0 && m.c === 0 ? { xscale: m.a * 100, yscale: m.d * 100, rotation: 0, skew: 0 }
        : { xscale: Math.hypot(m.a, m.b) * 100, yscale: flip * Math.hypot(m.c, m.d) * 100, rotation: Math.atan2(m.b + 0, m.a) * DEG, skew: Math.atan2(-m.c * flip + 0, m.d * flip) - Math.atan2(m.b + 0, m.a) };
    }
    return d.xform;
  };
  const setXform = (d, values) => {
    const t = Object.assign(xform(d), values);
    const rx = t.rotation / DEG;
    const ry = rx + t.skew;
    // 拡大率や回転から作る行列の成分は、1/65536 刻みの固定小数点数で計算される（実機で確認: 拡大率は切り捨て、
    // 三角関数は四捨五入、その積は四捨五入）。傾きのある行列では、実機の値とわずかに違う（実機の計算の精度が低い）。
    const mul = (scale, trig) => Math.round((Math.trunc(scale * 655.36) * Math.round(trig * 65536)) / 65536) / 65536;
    d.setMatrix({ a: mul(t.xscale, Math.cos(rx)), b: mul(t.xscale, Math.sin(rx)), c: mul(-t.yscale, Math.sin(ry)), d: mul(t.yscale, Math.cos(ry)), tx: d.matrix.tx, ty: d.matrix.ty });
  };
  const size = (d, axis) => { const b = d.boundsInParent?.(); return b ? (axis === 'x' ? b.xmax - b.xmin : b.ymax - b.ymin) / 20 : 0; };
  const geom = installGeom(vm, onStage);
  c.DisplayObject = vm.defineClass({
    name: 'flash.display::DisplayObject', base: c.EventDispatcher, allocate,
    methods: geom.methods, // localToGlobal、getBounds、hitTestPoint など
    getters: {
      transform: geom.getTransform,
      x: (self) => D(self).matrix.tx / 20, y: (self) => D(self).matrix.ty / 20,
      scaleX: (self) => xform(D(self)).xscale / 100, scaleY: (self) => xform(D(self)).yscale / 100,
      rotation: (self) => xform(D(self)).rotation,
      alpha: (self) => (D(self).cxform?.am ?? 256) / 256,
      visible: (self) => D(self).visible,
      opaqueBackground: (self) => D(self).opaqueBackground ?? null,
      filters: (self) => filters.read(D(self).filters),
      name: (self) => D(self).name,
      // ボタンの状態として使われているものには、親が無い。
      parent: (self) => (D(self).parent?.states ? null : D(self).parent ? display.wrap(D(self).parent) : onStage(D(self)) ? display.stage : null),
      // ステージに直接入れたものの root は、ステージになる。Loader で読み込んだ SWF の中のものの root は、その SWF のルート
      // （ステージに載る前でも）。
      root: (self) => {
        const loaded = loadedRootOf(D(self));
        return loaded ? display.wrap(loaded) : onStage(D(self)) ? display.wrap(topOf(D(self))) : null;
      },
      stage: (self) => (onStage(D(self)) ? display.stage : null),
      loaderInfo: (self) => {
        const loaded = loadedRootOf(D(self));
        return loaded ? loaded.loadedInfo : onStage(D(self)) ? display.loaderInfo() : null;
      },
      width: (self) => size(D(self), 'x'), height: (self) => size(D(self), 'y'),
      mouseX: (self) => D(self).globalToLocal(movie.mouse.x, movie.mouse.y).x / 20, mouseY: (self) => D(self).globalToLocal(movie.mouse.x, movie.mouse.y).y / 20,
    },
    setters: {
      transform: geom.setTransform,
      // 位置は twips に切り捨てて持つ（AVM1 と同じ）。
      x: (self, v) => { const n = num(v); if (!Number.isNaN(n)) D(self).setMatrix({ ...D(self).matrix, tx: Math.trunc(n * 20) }); },
      y: (self, v) => { const n = num(v); if (!Number.isNaN(n)) D(self).setMatrix({ ...D(self).matrix, ty: Math.trunc(n * 20) }); },
      scaleX: (self, v) => setXform(D(self), { xscale: num(v) * 100 }),
      scaleY: (self, v) => setXform(D(self), { yscale: num(v) * 100 }),
      rotation: (self, v) => { const r = num(v) % 360; setXform(D(self), { rotation: r > 180 ? r - 360 : r < -180 ? r + 360 : r }); },
      alpha: (self, v) => D(self).setCxform({ ...(D(self).cxform ?? { rm: 256, gm: 256, bm: 256, am: 256, ra: 0, ga: 0, ba: 0, aa: 0 }), am: Math.trunc(num(v) * 256) }),
      visible: (self, v) => { D(self).visible = vm.toBoolean(v); },
      filters: (self, v) => { D(self).filters = filters.write(v); D(self).scriptedFilters = true; },
      opaqueBackground: (self, v) => { D(self).opaqueBackground = v === null || v === undefined ? null : vm.toUint32(v) & 0xffffff; },
      name: (self, v) => { D(self).name = str(v); },
      // 中身が無い（大きさが 0 の）ものに幅や高さを設定すると、拡大率が 0 になる（実機で確認）。
      width: (self, v) => { const w = size(D(self), 'x'); setXform(D(self), { xscale: w > 0 ? (xform(D(self)).xscale * num(v)) / w : 0 }); },
      height: (self, v) => { const h = size(D(self), 'y'); setXform(D(self), { yscale: h > 0 ? (xform(D(self)).yscale * num(v)) / h : 0 }); },
    },
  });
  c.InteractiveObject = vm.defineClass({
    name: 'flash.display::InteractiveObject', base: c.DisplayObject,
    // マウスへの反応の設定は、当たり判定をするプレイヤー側（表示オブジェクト）に持つ。
    getters: { mouseEnabled: (self) => D(self).mouseEnabled ?? true, doubleClickEnabled: () => false, tabEnabled: () => false },
    setters: { mouseEnabled: (self, v) => { D(self).mouseEnabled = vm.toBoolean(v); }, doubleClickEnabled: () => {}, tabEnabled: () => {} },
  });

  installText(vm, movie);
  installBitmap(vm, movie);
  installStdlib(vm);
  const geom3d = installGeom3D(vm, movie);
  installXMLDocument(vm);
  const filters = installFilters(vm);

  // --- 子の出し入れ ---
  const container = (self) => D(self);
  const children = (self) => { const d = container(self); return d.sortedChildren && !d.leaf ? d.sortedChildren() : []; };
  const childOf = (self, child) => {
    if (!(child instanceof ASObject) || !child.display?.worldMatrix) vm.throwError('TypeError', 2007, 'Parameter child must be non-null.');
    return child.display;
  };
  // 子と子孫へ、上から順にイベントを届ける（聞いているものにだけ）。
  const sendDown = (d, type) => {
    if (d.as3?.listeners?.get(type)?.length) send(d.as3, c.Event, [type]);
    for (const child of d.sortedChildren?.() ?? []) sendDown(child, type);
  };
  // 親からステージまでのどこかに、type のリスナーがあるか（無ければ、イベントのオブジェクトを作らずに済ませる）。
  const heard = (d, type) => {
    for (let a = d; a; a = a.parent) if (a.as3?.listeners?.get(type)?.length) return true;
    return !!display.stage.listeners?.get(type)?.length;
  };
  /** 表示オブジェクト d が表示リストから外される直前に呼ばれる（タイムラインによる削除と removeChild の両方）。 */
  display.removing = (d) => {
    if (heard(d, 'removed')) send(display.wrap(d), c.Event, ['removed', true]);
    if (onStage(d)) sendDown(d, 'removedFromStage');
  };
  const remove = (self, child) => {
    const d = childOf(self, child);
    if (d.parent !== container(self)) vm.throwError('ArgumentError', 2025, 'The supplied DisplayObject must be a child of the caller.');
    d.parent.detachChild(d);
    return child;
  };
  // index を省くと、いちばん上に入れる。
  const add = (self, child, index) => {
    const d = childOf(self, child);
    const parent = container(self);
    if (child === self) vm.throwError('ArgumentError', 2024, 'An object cannot be added as a child of itself.');
    for (let a = parent; a; a = a.parent) if (a === d) vm.throwError('ArgumentError', 2150, "An object cannot be added as a child to one of it's children (or children's children, etc.).");
    const count = children(self).length;
    if (index !== undefined && (index < 0 || index > count)) vm.throwError('RangeError', 2006, 'The supplied index is out of bounds.');
    if (d.parent === parent) {
      // 同じ親の中での移動は、順序が変わるだけ。
      parent.setChildIndex(d, Math.min(index ?? count - 1, count - 1));
      return child;
    }
    const from = d.parent ?? (d === movie.root && !d.removed ? movie.stage : null); // ルートは、parent が null のままステージの子になっている
    if (from) from.detachChild(d);
    if (!parent.insertChild(d, index)) return child;
    if (d === movie.root && parent === movie.stage) d.parent = null;
    if (heard(d, 'added')) send(child, c.Event, ['added', true]);
    if (onStage(d)) sendDown(d, 'addedToStage');
    return child;
  };
  const childAt = (self, i) => {
    const child = children(self)[vm.toInt32(i)];
    if (!child) vm.throwError('RangeError', 2006, 'The supplied index is out of bounds.');
    return child;
  };
  const indexOf = (self, child) => {
    const i = children(self).indexOf(child?.display);
    if (i < 0) vm.throwError('ArgumentError', 2025, 'The supplied DisplayObject must be a child of the caller.');
    return i;
  };
  c.DisplayObjectContainer = vm.defineClass({
    name: 'flash.display::DisplayObjectContainer', base: c.InteractiveObject,
    getters: { numChildren: (self) => children(self).length, mouseChildren: (self) => D(self).mouseChildren ?? true },
    setters: { mouseChildren: (self, v) => { D(self).mouseChildren = vm.toBoolean(v); } },
    methods: {
      addChild: (self, [child]) => add(self, child),
      addChildAt: (self, [child, index]) => add(self, child, vm.toInt32(index)),
      removeChild: (self, [child]) => remove(self, child),
      removeChildAt: (self, [i]) => remove(self, display.wrap(childAt(self, i))),
      removeChildren: (self, [begin = 0, end = 0x7fffffff]) => {
        const list = children(self);
        const last = vm.toInt32(end) === 0x7fffffff ? list.length - 1 : vm.toInt32(end);
        if (vm.toInt32(begin) < 0 || last >= list.length) vm.throwError('RangeError', 2006, 'The supplied index is out of bounds.');
        for (const child of list.slice(vm.toInt32(begin), last + 1)) if (child.parent === container(self)) remove(self, display.wrap(child));
      },
      getChildAt: (self, [i]) => display.wrap(childAt(self, i)),
      getChildByName: (self, [name]) => { const child = children(self).find((ch) => ch.name === str(name)); return child ? display.wrap(child) : null; },
      getChildIndex: (self, [child]) => indexOf(self, child),
      setChildIndex: (self, [child, index]) => {
        indexOf(self, child);
        if (vm.toInt32(index) < 0 || vm.toInt32(index) >= children(self).length) vm.throwError('RangeError', 2006, 'The supplied index is out of bounds.');
        container(self).setChildIndex(child.display, vm.toInt32(index));
      },
      swapChildren: (self, [a, b]) => {
        const i = indexOf(self, a);
        const j = indexOf(self, b);
        container(self).setChildIndex(a.display, j);
        container(self).setChildIndex(b.display, i);
      },
      swapChildrenAt: (self, [i, j]) => {
        const a = childAt(self, i);
        const b = childAt(self, j);
        container(self).setChildIndex(a, vm.toInt32(j));
        container(self).setChildIndex(b, vm.toInt32(i));
      },
      contains: (self, [child]) => { for (let d = child?.display; d; d = d.parent) if (d === container(self)) return true; return false; },
    },
  });

  // --- 描画 API (graphics) ---
  // 描き先は表示オブジェクトの drawing()（AVM1 の描画 API と同じもの）。座標は twips にして渡す。
  const rgba = (color, alpha) => {
    const n = vm.toUint32(color);
    const a = alpha === undefined ? 1 : num(alpha);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: Math.round(Math.min(Math.max(a, 0), 1) * 255) };
  };
  // new Graphics() で直接作ったもの（描き先が無い）への描画は、何もしない。
  const nowhere = { clear() {}, lineStyle() {}, lineGradient() {}, beginFill() {}, beginStyle() {}, endFill() {}, moveTo() {}, lineTo() {}, curveTo() {}, cubicTo() {}, setWinding() {}, fillStyle() { return null; }, fillTriangle() {} };
  const G = (self) => self.display?.drawing?.() ?? nowhere;
  // 楕円は、実機と同じく 8 本の 2 次ベジェ曲線で描く。
  const ellipse = (g, cx, cy, rx, ry) => {
    const k = Math.tan(Math.PI / 8);
    g.moveTo((cx + rx) * 20, cy * 20);
    for (let i = 1; i <= 8; i++) {
      const mid = ((i - 0.5) * Math.PI) / 4;
      const end = (i * Math.PI) / 4;
      const r = Math.hypot(1, k);
      g.curveTo((cx + rx * r * Math.cos(mid)) * 20, (cy + ry * r * Math.sin(mid)) * 20, (cx + rx * Math.cos(end)) * 20, (cy + ry * Math.sin(end)) * 20);
    }
  };
  vm.defineClass({ name: 'flash.display::CapsStyle', final: true, staticValues: { ROUND: 'round', NONE: 'none', SQUARE: 'square' } });
  vm.defineClass({ name: 'flash.display::JointStyle', final: true, staticValues: { ROUND: 'round', BEVEL: 'bevel', MITER: 'miter' } });
  vm.defineClass({ name: 'flash.display::LineScaleMode', final: true, staticValues: { NORMAL: 'normal', NONE: 'none', VERTICAL: 'vertical', HORIZONTAL: 'horizontal' } });
  vm.defineClass({ name: 'flash.display::GradientType', final: true, staticValues: { LINEAR: 'linear', RADIAL: 'radial' } });
  vm.defineClass({ name: 'flash.display::SpreadMethod', final: true, staticValues: { PAD: 'pad', REFLECT: 'reflect', REPEAT: 'repeat' } });
  vm.defineClass({ name: 'flash.display::InterpolationMethod', final: true, staticValues: { RGB: 'rgb', LINEAR_RGB: 'linearRGB' } });
  // 角の丸い四角形。角は、楕円の 4 分の 1 を 2 本の 2 次曲線で描く。corners は、左上・右上・右下・左下の [x 方向の半径, y 方向の半径]。
  // 幅や高さが負なら、反対側へ向けて描く。半径が 0 の角は直角（実機で確認。始点と曲線の分け方は、画面が一致する程度に合わせた）。
  const roundRect = (g, x, y, w, h, corners) => {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    const [tl, tr, br, bl] = corners.map(([rx, ry]) => (rx > 0 && ry > 0 ? [Math.min(rx, w / 2), Math.min(ry, h / 2)] : [0, 0]));
    const k = 1 / Math.cos(Math.PI / 8);
    const corner = (cx, cy, [rx, ry], a0, px, py) => {
      if (!rx) { g.lineTo(px * 20, py * 20); return; }
      for (let i = 0; i < 2; i++) {
        const mid = a0 + ((i + 0.5) * Math.PI) / 4, end = a0 + ((i + 1) * Math.PI) / 4;
        g.curveTo((cx + rx * k * Math.cos(mid)) * 20, (cy + ry * k * Math.sin(mid)) * 20, (cx + rx * Math.cos(end)) * 20, (cy + ry * Math.sin(end)) * 20);
      }
    };
    g.moveTo((x + tl[0]) * 20, y * 20);
    g.lineTo((x + w - tr[0]) * 20, y * 20);
    corner(x + w - tr[0], y + tr[1], tr, -Math.PI / 2, x + w, y);
    g.lineTo((x + w) * 20, (y + h - br[1]) * 20);
    corner(x + w - br[0], y + h - br[1], br, 0, x + w, y + h);
    g.lineTo((x + bl[0]) * 20, (y + h) * 20);
    corner(x + bl[0], y + h - bl[1], bl, Math.PI / 2, x, y + h);
    g.lineTo(x * 20, (y + tl[1]) * 20);
    corner(x + tl[0], y + tl[1], tl, Math.PI, x, y);
  };
  // 種類が null、色が null なら TypeError #2007、種類が "linear" と "radial" 以外なら ArgumentError #2008（名前は大文字と小文字を区別する）。
  // alphas が null なら全部 1、ratios が null なら等間隔。色と alphas・ratios の数が合わない、ratios が 0〜255 の外なら塗りなし。
  // spreadMethod と interpolationMethod は、知らない名前なら "pad" と "rgb" 扱い。行列が無ければ、原点を中心にした 200 px 四方の箱（実機で確認）。
  const gradientOf = (type, colors, alphas, ratios, matrix, spread, interpolation, focal) => {
    const nonNull = (v, name) => { if (v === undefined || v === null) vm.throwError('TypeError', 2007, `Parameter ${name} must be non-null.`); };
    nonNull(type, 'type');
    nonNull(colors, 'colors');
    if (str(type) !== 'linear' && str(type) !== 'radial') vm.throwError('ArgumentError', 2008, 'Parameter type must be one of the accepted values.');
    const list = (v) => (v instanceof ASArray ? v.items : null);
    const cs = list(colors) ?? [];
    const as = alphas === undefined || alphas === null ? cs.map(() => 1) : list(alphas);
    const rs = ratios === undefined || ratios === null ? cs.map((_, i) => (cs.length > 1 ? Math.round((i * 255) / (cs.length - 1)) : 0)) : list(ratios)?.map(num);
    let style = null;
    if (as && rs && cs.length === as.length) {
      const field = (name, otherwise) => (matrix instanceof ASObject ? num(matrix.values.get(publicKey(name))) : otherwise);
      style = gradientStyle({
        type: str(type),
        colors: cs.map((color, i) => rgba(color, as[i])),
        ratios: rs,
        matrix: { a: field('a', 200 / 1638.4), b: field('b', 0), c: field('c', 0), d: field('d', 200 / 1638.4), tx: field('tx', 0) * 20, ty: field('ty', 0) * 20 },
        spread: spread === undefined || spread === null ? undefined : ['pad', 'reflect', 'repeat'].find((x) => x === str(spread)),
        linearRGB: interpolation !== undefined && interpolation !== null && str(interpolation) === 'linearRGB',
        focal: focal === undefined ? 0 : num(focal),
      });
    }
    return style;
  };
  // beginBitmapFill / lineBitmapStyle の塗り。行列はビットマップの画素から描く座標（px）へ。省略すると、原点に等倍で置く。
  // 既定は繰り返しあり・補間なし。ビットマップは参照で持つので、あとで画素を変えると、塗りも変わる（実機で確認）。
  const bitmapStyleOf = (bitmap, matrix, repeat, smooth) => {
    if (!(bitmap instanceof ASObject) || !bitmap.klass?.isSubclassOf?.(c.BitmapData)) vm.throwError('TypeError', 2007, 'Parameter bitmap must be non-null.');
    const field = (name, otherwise) => (matrix instanceof ASObject ? num(matrix.values.get(publicKey(name))) : otherwise);
    return {
      type: 'bitmap', bitmap: bitmap.bitmap,
      matrix: { a: field('a', 1) * 20, b: field('b', 0) * 20, c: field('c', 0) * 20, d: field('d', 1) * 20, tx: field('tx', 0) * 20, ty: field('ty', 0) * 20 },
      repeat: repeat === undefined || repeat === null ? true : vm.toBoolean(repeat), smooth: smooth === undefined || smooth === null ? false : vm.toBoolean(smooth),
    };
  };
  const get = (obj, name) => obj.values.get(publicKey(name));
  // drawPath: 命令（1 moveTo、2 lineTo、3 curveTo、4 wideMoveTo、5 wideLineTo、6 cubicCurveTo。wide は前の 2 つの値を飛ばす）。
  // 知らない命令は飛ばす。データが足りなければ ArgumentError #2004、winding が evenOdd と nonZero 以外なら #2008（実機で確認）。
  const PATH_DATA = { 1: 2, 2: 2, 3: 4, 4: 4, 5: 4, 6: 6 };
  const drawPath = (g, commands, data, winding) => {
    const w = winding === null || winding === undefined ? 'evenOdd' : str(winding);
    if (w !== 'evenOdd' && w !== 'nonZero') vm.throwError('ArgumentError', 2008, 'Parameter winding must be one of the accepted values.');
    if (!(commands instanceof ASVector) || !(data instanceof ASVector)) return;
    const cmds = commands.items.map((v) => vm.toInt32(v)), d = data.items.map(num);
    if (cmds.reduce((n, cmd) => n + (PATH_DATA[cmd] ?? 0), 0) > d.length) vm.throwError('ArgumentError', 2004, 'One of the parameters is invalid.');
    g.setWinding(w === 'evenOdd');
    let i = 0;
    const p = () => d[i++] * 20;
    for (const cmd of cmds) {
      if (cmd === 1) g.moveTo(p(), p());
      else if (cmd === 2) g.lineTo(p(), p());
      else if (cmd === 3) g.curveTo(p(), p(), p(), p());
      else if (cmd === 4) { i += 2; g.moveTo(p(), p()); } else if (cmd === 5) { i += 2; g.lineTo(p(), p()); } else if (cmd === 6) g.cubicTo(p(), p(), p(), p(), p(), p());
    }
  };
  c.Graphics = vm.defineClass({
    name: 'flash.display::Graphics', final: true,
    methods: {
      clear: (self) => { G(self).clear(); },
      lineStyle: (self, [thickness, color = 0, alpha, pixelHinting, scaleMode, caps, joints, miterLimit]) => {
        const w = thickness === undefined ? NaN : num(thickness);
        const word = (v) => (v === undefined || v === null ? undefined : str(v));
        G(self).lineStyle(Number.isNaN(w) ? undefined : Math.min(Math.max(w, 0), 255) * 20, rgba(color, alpha), lineOptions({
          pixelHinting: pixelHinting === undefined ? false : vm.toBoolean(pixelHinting), scaleMode: word(scaleMode), caps: word(caps), joints: word(joints), miterLimit: miterLimit === undefined ? 3 : num(miterLimit),
        }));
      },
      beginFill: (self, [color, alpha]) => { G(self).beginFill(rgba(color, alpha)); },
      beginGradientFill: (self, args) => { G(self).beginStyle(gradientOf(...args)); },
      lineGradientStyle: (self, args) => { G(self).lineGradient(gradientOf(...args)); },
      beginBitmapFill: (self, [bitmap, matrix, repeat, smooth]) => { G(self).beginStyle(bitmapStyleOf(bitmap, matrix, repeat, smooth)); },
      lineBitmapStyle: (self, [bitmap, matrix, repeat, smooth]) => { G(self).lineGradient(bitmapStyleOf(bitmap, matrix, repeat, smooth)); },
      endFill: (self) => { G(self).endFill(); },
      cubicCurveTo: (self, [c1x, c1y, c2x, c2y, x, y]) => { G(self).cubicTo(num(c1x) * 20, num(c1y) * 20, num(c2x) * 20, num(c2y) * 20, num(x) * 20, num(y) * 20); },
      drawPath: (self, [commands, data, winding = 'evenOdd']) => { drawPath(G(self), commands, data, winding); },
      // drawTriangles(頂点, 添字, uvt, 裏向きの省略): 添字が無ければ頂点を 3 つずつ。positive は符号付き面積が正（画面で時計回り）のもの、
      // negative は負のものを描かない。塗りがビットマップで uvt があれば、三角形ごとに UV（0〜1）で貼る（t は使わない）。
      // 三角形が 1 つもできなければ ArgumentError #2004、裏向きの指定が不正なら #2008（実機で確認）。
      drawTriangles: (self, [vertices, indices = null, uvt = null, culling = 'none']) => {
        const cull = str(culling);
        if (!['none', 'positive', 'negative'].includes(cull)) vm.throwError('ArgumentError', 2008, 'Parameter culling must be one of the accepted values.');
        if (!(vertices instanceof ASVector)) return;
        const v = vertices.items.map(num), n = v.length >> 1;
        const idx = indices instanceof ASVector ? indices.items.map((i) => vm.toInt32(i)) : Array.from({ length: n - (n % 3) }, (_, i) => i);
        if (idx.length < 3) vm.throwError('ArgumentError', 2004, 'One of the parameters is invalid.');
        const g = G(self), style = g.fillStyle();
        const uv = uvt instanceof ASVector ? uvt.items.map(num) : null;
        const stride = uv ? (uv.length >= n * 3 ? 3 : 2) : 0;
        for (let k = 0; k + 2 < idx.length; k += 3) {
          const tri = [idx[k], idx[k + 1], idx[k + 2]];
          if (tri.some((i) => i < 0 || i >= n)) continue;
          const [p0, p1, p2] = tri.map((i) => [v[i * 2], v[i * 2 + 1]]);
          const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
          if ((cull === 'positive' && area > 0) || (cull === 'negative' && area < 0)) continue;
          const points = [p0, p1, p2].map(([x, y]) => [x * 20, y * 20]);
          if (style?.type === 'bitmap' && uv && style.bitmap) {
            // 画像の画素 (u × 幅, v × 高さ) を、頂点（twips）へ写すアフィン変換で、三角形ごとに貼る。t（遠近）があれば、三角形を
            // 細かく分けて、遠近を正しく補間した UV で貼る。
            const W = style.bitmap.width, H = style.bitmap.height;
            const tex = tri.map((i) => ({ u: uv[i * stride], v: uv[i * stride + 1], t: stride === 3 ? uv[i * stride + 2] || 1e-9 : 1 }));
            const put = (q0, q1, q2) => {
              const [s0, s1, s2] = [q0.p, q1.p, q2.p], [t0, t1, t2] = [q0.t, q1.t, q2.t];
              const det = (t1[0] - t0[0]) * (t2[1] - t0[1]) - (t2[0] - t0[0]) * (t1[1] - t0[1]);
              if (!det) return;
              const a = ((s1[0] - s0[0]) * (t2[1] - t0[1]) - (s2[0] - s0[0]) * (t1[1] - t0[1])) / det;
              const cc = ((s2[0] - s0[0]) * (t1[0] - t0[0]) - (s1[0] - s0[0]) * (t2[0] - t0[0])) / det;
              const b = ((s1[1] - s0[1]) * (t2[1] - t0[1]) - (s2[1] - s0[1]) * (t1[1] - t0[1])) / det;
              const d = ((s2[1] - s0[1]) * (t1[0] - t0[0]) - (s1[1] - s0[1]) * (t2[0] - t0[0])) / det;
              g.fillTriangle([s0, s1, s2], { ...style, matrix: { a, b, c: cc, d, tx: s0[0] - a * t0[0] - cc * t0[1], ty: s0[1] - b * t0[0] - d * t0[1] } });
            };
            const at = (wa, wb, wc) => {
              const p = [0, 1].map((k) => points[0][k] * wa + points[1][k] * wb + points[2][k] * wc);
              const z = tex[0].t * wa + tex[1].t * wb + tex[2].t * wc;
              const u = (tex[0].u * tex[0].t * wa + tex[1].u * tex[1].t * wb + tex[2].u * tex[2].t * wc) / z;
              const vv = (tex[0].v * tex[0].t * wa + tex[1].v * tex[1].t * wb + tex[2].v * tex[2].t * wc) / z;
              return { p, t: [u * W, vv * H] };
            };
            const N = stride === 3 && !(tex[0].t === tex[1].t && tex[1].t === tex[2].t) ? 8 : 1;
            for (let i = 0; i < N; i++) {
              for (let j = 0; j < N - i; j++) {
                put(at(1 - (i + j) / N, i / N, j / N), at(1 - (i + 1 + j) / N, (i + 1) / N, j / N), at(1 - (i + j + 1) / N, i / N, (j + 1) / N));
                if (j < N - i - 1) put(at(1 - (i + 1 + j) / N, (i + 1) / N, j / N), at(1 - (i + j + 2) / N, (i + 1) / N, (j + 1) / N), at(1 - (i + j + 1) / N, i / N, (j + 1) / N));
              }
            }
          } else if (style) g.fillTriangle(points, style);
        }
      },
      // 並びの中の塗り・線・パスを、順に描く。知らないもの（三角形・シェーダ）は飛ばす。
      drawGraphicsData: (self, [list]) => {
        if (!(list instanceof ASVector)) return;
        const g = G(self);
        const is = (o, name) => o instanceof ASObject && o.klass === c[name];
        const fillStyle = (f) => (is(f, 'GraphicsSolidFill') ? { type: 'solid', color: rgba(get(f, 'color'), get(f, 'alpha')) }
          : is(f, 'GraphicsGradientFill') ? gradientOf(get(f, 'type'), get(f, 'colors'), get(f, 'alphas'), get(f, 'ratios'), get(f, 'matrix'), get(f, 'spreadMethod'), get(f, 'interpolationMethod'), get(f, 'focalPointRatio'))
            : is(f, 'GraphicsBitmapFill') && get(f, 'bitmapData') ? bitmapStyleOf(get(f, 'bitmapData'), get(f, 'matrix'), get(f, 'repeat'), get(f, 'smooth')) : null);
        for (const item of list.items) {
          if (is(item, 'GraphicsPath')) drawPath(g, item.gp.commands, item.gp.data, item.gp.winding);
          else if (is(item, 'GraphicsEndFill')) g.endFill();
          else if (is(item, 'GraphicsStroke')) {
            const w = num(get(item, 'thickness'));
            if (Number.isNaN(w)) { g.lineStyle(undefined); continue; }
            const fill = get(item, 'fill'), style = fillStyle(fill);
            g.lineStyle(Math.min(Math.max(w, 0), 255) * 20, style?.type === 'solid' ? style.color : rgba(0, 1), lineOptions({
              pixelHinting: vm.toBoolean(get(item, 'pixelHinting')), scaleMode: str(get(item, 'scaleMode')), caps: str(get(item, 'caps')), joints: str(get(item, 'joints')), miterLimit: num(get(item, 'miterLimit')),
            }));
            if (style && style.type !== 'solid') g.lineGradient(style);
          } else if (item instanceof ASObject) { const style = fillStyle(item); if (style || is(item, 'GraphicsBitmapFill')) g.beginStyle(style); }
        }
      },
      moveTo: (self, [x, y]) => { G(self).moveTo(num(x) * 20, num(y) * 20); },
      lineTo: (self, [x, y]) => { G(self).lineTo(num(x) * 20, num(y) * 20); },
      curveTo: (self, [cx, cy, x, y]) => { G(self).curveTo(num(cx) * 20, num(cy) * 20, num(x) * 20, num(y) * 20); },
      drawRect: (self, [x, y, w, h]) => {
        const g = G(self);
        const [l, t, r, b] = [num(x) * 20, num(y) * 20, (num(x) + num(w)) * 20, (num(y) + num(h)) * 20];
        g.moveTo(l, t);
        g.lineTo(r, t);
        g.lineTo(r, b);
        g.lineTo(l, b);
        g.lineTo(l, t);
      },
      // 楕円の幅と高さ（半径の 2 倍）で丸める。高さを省く（NaN）と、幅と同じ。
      drawRoundRect: (self, [x, y, w, h, ellipseWidth, ellipseHeight]) => {
        const ew = num(ellipseWidth) / 2;
        const eh = ellipseHeight === undefined || Number.isNaN(num(ellipseHeight)) ? ew : num(ellipseHeight) / 2;
        const c4 = [ew, eh];
        roundRect(G(self), num(x), num(y), num(w), num(h), [c4, c4, c4, c4]);
      },
      drawRoundRectComplex: (self, [x, y, w, h, topLeftRadius, topRightRadius, bottomLeftRadius, bottomRightRadius]) => {
        const r = (v) => [num(v), num(v)];
        roundRect(G(self), num(x), num(y), num(w), num(h), [r(topLeftRadius), r(topRightRadius), r(bottomRightRadius), r(bottomLeftRadius)]);
      },
      drawCircle: (self, [x, y, r]) => { ellipse(G(self), num(x), num(y), num(r), num(r)); },
      drawEllipse: (self, [x, y, w, h]) => { ellipse(G(self), num(x) + num(w) / 2, num(y) + num(h) / 2, num(w) / 2, num(h) / 2); },
    },
  });
  // --- drawGraphicsData の材料（IGraphicsData）。既定値は実機で確認 ---
  const iface = (name) => vm.classByName(`flash.display::${name}`);
  const plainData = (name, fields, interfaces) => (c[name] = vm.defineClass({
    name: `flash.display::${name}`, final: true, interfaces: interfaces.map(iface),
    slots: Object.fromEntries(fields.map(([key, initial]) => [key, initial])),
    construct: (self, args) => { fields.forEach(([key, initial, convert], i) => self.values.set(publicKey(key), args[i] === undefined ? initial : convert(args[i]))); },
  }));
  const wordOrNull = (v) => (v === null || v === undefined ? null : str(v));
  plainData('GraphicsSolidFill', [['color', 0, (v) => vm.toUint32(v)], ['alpha', 1, num]], ['IGraphicsData', 'IGraphicsFill']);
  plainData('GraphicsEndFill', [], ['IGraphicsData', 'IGraphicsFill']);
  plainData('GraphicsBitmapFill', [['bitmapData', null, same], ['matrix', null, same], ['repeat', true, bool], ['smooth', false, bool]], ['IGraphicsData', 'IGraphicsFill']);
  plainData('GraphicsGradientFill', [['type', 'linear', wordOrNull], ['colors', null, same], ['alphas', null, same], ['ratios', null, same], ['matrix', null, same], ['spreadMethod', 'pad', same], ['interpolationMethod', 'rgb', wordOrNull], ['focalPointRatio', 0, num]], ['IGraphicsData', 'IGraphicsFill']);
  plainData('GraphicsStroke', [['thickness', NaN, num], ['pixelHinting', false, bool], ['scaleMode', 'normal', wordOrNull], ['caps', 'none', wordOrNull], ['joints', 'round', wordOrNull], ['miterLimit', 3, num], ['fill', null, same]], ['IGraphicsData', 'IGraphicsStroke']);
  vm.defineClass({ name: 'flash.display::TriangleCulling', final: true, staticValues: { NONE: 'none', POSITIVE: 'positive', NEGATIVE: 'negative' } });
  plainData('GraphicsTrianglePath', [['vertices', null, same], ['indices', null, same], ['uvtData', null, same], ['culling', 'none', wordOrNull]], ['IGraphicsData', 'IGraphicsPath']);
  vm.defineClass({ name: 'flash.display::GraphicsPathCommand', final: true, staticValues: { NO_OP: 0, MOVE_TO: 1, LINE_TO: 2, CURVE_TO: 3, WIDE_MOVE_TO: 4, WIDE_LINE_TO: 5, CUBIC_CURVE_TO: 6 } });
  vm.defineClass({ name: 'flash.display::GraphicsPathWinding', final: true, staticValues: { EVEN_ODD: 'evenOdd', NON_ZERO: 'nonZero' } });
  // GraphicsPath: 命令とデータの Vector（無ければ null。moveTo などで足すときに作る）と、winding（evenOdd か nonZero。ほかは #2008）。
  const pathWinding = (v) => {
    const w = str(v);
    if (w !== 'evenOdd' && w !== 'nonZero') vm.throwError('ArgumentError', 2008, 'Parameter winding must be one of the accepted values.');
    return w;
  };
  const push = (self, cmd, ...values) => {
    const gp = self.gp;
    gp.commands ??= new ASVector(vm.applyType(c.Vector, [c.int]), []);
    gp.data ??= new ASVector(vm.applyType(c.Vector, [c.Number]), []);
    gp.commands.items.push(cmd);
    gp.data.items.push(...values.map(num));
  };
  c.GraphicsPath = vm.defineClass({
    name: 'flash.display::GraphicsPath', final: true, interfaces: [iface('IGraphicsData'), iface('IGraphicsPath')],
    allocate: (klass) => Object.assign(new ASObject(klass), { gp: { commands: null, data: null, winding: 'evenOdd' } }),
    construct: (self, [commands = null, data = null, winding = 'evenOdd']) => { Object.assign(self.gp, { commands, data, winding: pathWinding(winding) }); },
    getters: { commands: (self) => self.gp.commands, data: (self) => self.gp.data, winding: (self) => self.gp.winding },
    setters: { commands: (self, v) => { self.gp.commands = v; }, data: (self, v) => { self.gp.data = v; }, winding: (self, v) => { self.gp.winding = pathWinding(v); } },
    methods: {
      moveTo: (self, [x, y]) => push(self, 1, x, y),
      lineTo: (self, [x, y]) => push(self, 2, x, y),
      curveTo: (self, [cx, cy, x, y]) => push(self, 3, cx, cy, x, y),
      wideMoveTo: (self, [x, y]) => push(self, 4, 0, 0, x, y),
      wideLineTo: (self, [x, y]) => push(self, 5, 0, 0, x, y),
      cubicCurveTo: (self, [c1x, c1y, c2x, c2y, x, y]) => push(self, 6, c1x, c1y, c2x, c2y, x, y),
    },
  });

  const graphics = (self) => {
    if (!self.graphics) {
      self.graphics = new ASObject(c.Graphics);
      self.graphics.display = D(self);
    }
    return self.graphics;
  };
  const media = installMedia(vm, movie);
  c.Sprite = vm.defineClass({
    name: 'flash.display::Sprite', base: c.DisplayObjectContainer,
    getters: { graphics, buttonMode: (self) => D(self).buttonMode ?? false, useHandCursor: (self) => D(self).useHandCursor ?? true, soundTransform: media.getSoundTransform },
    setters: { buttonMode: (self, v) => { D(self).buttonMode = vm.toBoolean(v); }, useHandCursor: (self, v) => { D(self).useHandCursor = vm.toBoolean(v); }, soundTransform: media.setSoundTransform },
  });
  // シーン（DefineSceneAndFrameLabelData）。無ければ、全体が名前の無い 1 つのシーンで、ラベルは FrameLabel タグのもの。
  // ラベルのフレーム番号は、タイムライン全体での番号。
  const scenesOf = (d) => {
    const total = d.frames.length;
    const list = d.frames.scenes ?? [{ name: '', offset: 0 }];
    const labels = d.frames.sceneLabels ?? [...d.frames.labels].map(([name, frame]) => ({ name, frame })).sort((a, b) => a.frame - b.frame);
    return list.map((scene, i) => {
      const end = i + 1 < list.length ? list[i + 1].offset : Math.max(total, 1);
      return { name: scene.name, offset: scene.offset, numFrames: end - scene.offset, labels: labels.filter((l) => l.frame > scene.offset && l.frame <= end) };
    });
  };
  const sceneAt = (d) => {
    const all = scenesOf(d);
    return all.findLast((scene) => scene.offset < d.currentFrame) ?? all[0];
  };
  // AS3 の Scene（毎回新しく作る。ラベルのフレーム番号はシーンの中での番号）。
  const sceneObject = (scene) => vm.construct(c.Scene, [
    scene.name, new ASArray(vm, scene.labels.map((l) => vm.construct(c.FrameLabel, [l.name, l.frame - scene.offset]))), scene.numFrames,
  ]);
  // フレームの指定（番号かラベル）をフレーム番号にする。番号はシーン（省略すると今のシーン）の先頭からの番号で、
  // ラベルはそのシーンの中で探す（実機で確認）。
  const frameOf = (d, spec, sceneName) => {
    let scene = sceneAt(d);
    if (sceneName !== null && sceneName !== undefined) {
      scene = scenesOf(d).find((s) => s.name === str(sceneName));
      if (!scene) vm.throwError('ArgumentError', 2108, `Scene ${str(sceneName)} was not found.`);
    }
    if (typeof spec === 'number') return scene.offset + Math.trunc(spec);
    if (/^\d+$/.test(str(spec))) return scene.offset + Number(str(spec));
    const label = scene.labels.find((l) => l.name === str(spec));
    if (!label) vm.throwError('ArgumentError', 2109, `Frame label ${str(spec)} not found in scene ${scene.name}.`);
    return label.frame;
  };
  // nextScene / prevScene: 隣のシーン（無ければ今のシーン）の先頭へ移って、再生する。
  const toScene = (self, step) => {
    const all = scenesOf(D(self));
    const at = Math.max(0, all.findLastIndex((scene) => scene.offset < D(self).currentFrame));
    const scene = all[at + step] ?? all[at];
    D(self).isPlaying = true;
    movie.gotoFrame(D(self), scene.offset + 1, true);
  };
  c.FrameLabel = vm.defineClass({
    name: 'flash.display::FrameLabel', base: c.EventDispatcher, final: true,
    construct: (self, [name, frame]) => { self.label = { name: str(name), frame: vm.toInt32(frame) }; },
    getters: { name: (self) => self.label.name, frame: (self) => self.label.frame },
  });
  c.Scene = vm.defineClass({
    name: 'flash.display::Scene', final: true,
    construct: (self, [name, labels, numFrames]) => { self.scene = { name: str(name), labels, numFrames: vm.toInt32(numFrames) }; },
    getters: { name: (self) => self.scene.name, labels: (self) => self.scene.labels, numFrames: (self) => self.scene.numFrames },
  });
  c.MovieClip = vm.defineClass({
    name: 'flash.display::MovieClip', base: c.Sprite, dynamic: true,
    getters: {
      // currentFrame は、今のシーンの中での番号。
      currentFrame: (self) => D(self).currentFrame - sceneAt(D(self)).offset, totalFrames: (self) => D(self).frames.length, framesLoaded: (self) => D(self).frames.length,
      // currentLabel は、シーンをまたいで、今のフレームかそれより前の最後のラベル。currentFrameLabel は、今のフレームの FrameLabel タグのラベル
      // （DefineSceneAndFrameLabelData だけにあるラベルは見ない。実機で確認）。
      currentLabel: (self) => { let label = null; for (const l of scenesOf(D(self)).flatMap((s) => s.labels)) if (l.frame <= D(self).currentFrame) label = l.name; return label; },
      currentFrameLabel: (self) => { for (const [name, frame] of D(self).frames.labels) if (frame === D(self).currentFrame) return name; return null; },
      currentLabels: (self) => { const scene = sceneAt(D(self)); return new ASArray(vm, scene.labels.map((l) => vm.construct(c.FrameLabel, [l.name, l.frame - scene.offset]))); },
      currentScene: (self) => sceneObject(sceneAt(D(self))),
      scenes: (self) => new ASArray(vm, scenesOf(D(self)).map(sceneObject)),
      // isPlaying は、play / gotoAndPlay と再生ヘッドの自動的な進行で真になり、stop で偽になる。gotoAndStop では変わらない（実機で確認）。
      isPlaying: (self) => D(self).isPlaying ?? false,
    },
    methods: {
      play: (self) => { D(self).playing = D(self).isPlaying = true; },
      stop: (self) => { D(self).playing = D(self).isPlaying = false; },
      gotoAndPlay: (self, [frame, scene]) => { const n = frameOf(D(self), frame, scene); D(self).isPlaying = true; movie.gotoFrame(D(self), n, true); },
      gotoAndStop: (self, [frame, scene]) => { movie.gotoFrame(D(self), frameOf(D(self), frame, scene), false); },
      nextScene: (self) => toScene(self, 1),
      prevScene: (self) => toScene(self, -1),
      nextFrame: (self) => { movie.gotoFrame(D(self), Math.min(D(self).currentFrame + 1, D(self).frames.length), false); },
      prevFrame: (self) => { movie.gotoFrame(D(self), D(self).currentFrame - 1, false); },
      // addFrameScript(フレーム番号（0 始まり）, 関数, ...)。そのフレームに入ったときに関数が呼ばれる。
      addFrameScript: (self, args) => {
        const scripts = (D(self).frameScripts ??= new Map());
        for (let i = 0; i + 1 < args.length; i += 2) {
          const frame = vm.toInt32(args[i]) + 1;
          if (args[i + 1] instanceof ASFunction) scripts.set(frame, args[i + 1]);
          else scripts.delete(frame);
          if (frame === D(self).currentFrame) D(self).scriptPending = true; // 今いるフレームなら、このフレームのうちに実行する
        }
      },
    },
  });
  c.Shape = vm.defineClass({ name: 'flash.display::Shape', base: c.DisplayObject, getters: { graphics } });
  c.MorphShape = vm.defineClass({ name: 'flash.display::MorphShape', base: c.DisplayObject });
  // SimpleButton。new で作ったものは、4 つの状態（up / over / down と、当たり判定用の hitTest）の表示オブジェクトを持つ。
  // タイムラインに置かれたボタンは、状態の中身をプレイヤー側が持つので、ここからは状態を取り出せない（null になる）。
  const stateOf = (v, name) => {
    if (v === null || v === undefined) return null;
    if (!(v instanceof ASObject) || !v.display?.worldMatrix) vm.throwError('TypeError', 1034, `Type Coercion failed: cannot convert ${vm.className(v)} to flash.display.DisplayObject. (${name})`);
    return v.display;
  };
  const state = (name) => [
    (self) => { const d = D(self).states?.[name]; return d ? display.wrap(d) : null; },
    (self, v) => {
      const d = D(self);
      if (!d.states) return;
      const next = stateOf(v, name);
      if (next?.parent && next.parent !== d) next.parent.detachChild(next); // ほかの親からは外れる
      d.states[name] = next;
      showState(d);
    },
  ];
  const states = { upState: state('up'), overState: state('over'), downState: state('down'), hitTestState: state('hit') };
  c.SimpleButton = vm.defineClass({
    name: 'flash.display::SimpleButton', base: c.InteractiveObject,
    construct: (self, [up = null, over = null, down = null, hit = null]) => {
      const d = D(self);
      if (d.character.button) return; // タイムラインに置かれたボタン
      d.states = { up: null, over: null, down: null, hit: null };
      d.buttonState = 'up';
      [up, over, down, hit].forEach((v, i) => { if (v !== null && v !== undefined) states[['upState', 'overState', 'downState', 'hitTestState'][i]][1](self, v); });
    },
    getters: {
      ...Object.fromEntries(Object.entries(states).map(([name, [get]]) => [name, get])),
      enabled: (self) => D(self).enabled ?? true, useHandCursor: (self) => D(self).useHandCursor ?? true, trackAsMenu: (self) => D(self).trackAsMenu ?? false,
      soundTransform: media.getSoundTransform,
    },
    setters: {
      ...Object.fromEntries(Object.entries(states).map(([name, [, set]]) => [name, set])),
      // 無効にすると、見た目が up のまま変わらなくなる（マウスのイベントは届く）。
      enabled: (self, v) => { const d = D(self); d.enabled = vm.toBoolean(v); if (!d.enabled && d.states) showState(d, 'up'); },
      useHandCursor: (self, v) => { D(self).useHandCursor = vm.toBoolean(v); }, trackAsMenu: (self, v) => { D(self).trackAsMenu = vm.toBoolean(v); },
      soundTransform: media.setSoundTransform,
    },
  });
  c.Stage = vm.defineClass({
    name: 'flash.display::Stage', base: c.DisplayObjectContainer,
    getters: {
      stageWidth: () => (movie.frameSize.xmax - movie.frameSize.xmin) / 20, stageHeight: () => (movie.frameSize.ymax - movie.frameSize.ymin) / 20,
      frameRate: () => movie.frameRate, parent: () => null, stage: (self) => self, root: (self) => self, name: () => null, loaderInfo: () => display.loaderInfo(true),
      mouseX: () => movie.mouse.x / 20, mouseY: () => movie.mouse.y / 20, x: () => 0, y: () => 0,
      scaleMode: (self) => self.scaleMode ?? 'showAll', align: (self) => self.align ?? '', focus: () => null,
    },
    setters: { scaleMode: (self, v) => { self.scaleMode = str(v); }, align: (self, v) => { self.align = str(v); }, frameRate: () => {}, focus: () => {} },
  });
  display.stage = new ASObject(c.Stage); // 表示オブジェクト（movie.stage）は、ルートができた後でプレイヤーが結び付ける

  installDisplayExtras(vm, { movie, display, D, xform, setXform, geom3d });

  // --- 表示リストとの結び付け ---
  // キャラクタに結び付けられたクラス（SymbolClass）。無ければ種類ごとの既定のクラス。
  const classFor = (d) => {
    const linked = (d.character.library?.symbolClasses ?? movie.symbolClasses).get(d.character.id);
    let klass;
    try {
      klass = linked ? vm.classByName(linked) : undefined;
    } catch (e) {
      // 紐づいたクラスが読めない（定義が SWF に無い）ときは、実機と同じく未処理の例外として表示し、既定のクラスで続ける。
      // 実機は、続行を押すと先へ進む（続行の後のクラスは実機で未確認）。例外のまま投げると、再生のタイマーが止まる。
      if (!(e instanceof ASThrown)) throw e;
      vm.trace(vm.describeError(e.value));
    }
    if (klass) return klass;
    if (d.character.button) return c.SimpleButton;
    if (d instanceof types.MovieClip) return c.MovieClip;
    if (d instanceof types.TextField) return c.TextField;
    if (d instanceof types.VideoObject) return c.Video;
    return d.character.type === 'morph' ? c.MorphShape : c.Shape;
  };
  /** 表示オブジェクト d に対応する AS3 のオブジェクトを作る（コンストラクタはまだ呼ばない）。 */
  display.attach = (d) => {
    const klass = classFor(d);
    const obj = new ASObject(klass);
    obj.display = d;
    d.as3 = obj;
    vm.initObject(obj);
    return obj;
  };
  /** コンストラクタを呼ぶ（子が作られた後）。名前があれば、親の同名のプロパティに入れる。 */
  display.construct = (d) => {
    // クリップ以外（図形など）は、イベントを聞くものがいなければ AS3 のオブジェクトを作らずに済ませる。
    // テキストフィールドとビデオは、名前で参照されるので必ず作る。
    const field = d instanceof types.TextField || d instanceof types.VideoObject;
    if (!d.as3 && !field && !heard(d, 'added')) return;
    const fresh = !d.as3;
    const obj = display.wrap(d);
    if (!fresh && obj.klass.constructorFn) vm.run(() => vm.call(obj.klass.constructorFn, obj, []), report);
    if (!fresh || field) display.named(d, obj);
    if (heard(d, 'added')) send(obj, c.Event, ['added', true]);
    if (onStage(d) && obj.listeners?.get('addedToStage')?.length) send(obj, c.Event, ['addedToStage']);
  };
  display.named = (d, value) => {
    const parent = d.parent?.as3;
    if (!parent || !d.name || d.name.startsWith('instance')) return;
    vm.run(() => vm.setProperty(parent, publicName(d.name), value), () => {}); // 宣言が無く動的でもないクラスなら、入れられない
  };
  /** 表示オブジェクトに対応する AS3 のオブジェクト（無ければ作る）。 */
  display.wrap = (d) => d.as3 ?? display.attach(d);

  // --- Timer ---
  const stopTimer = (self) => { timers.delete(self.timer.id); self.timer.id = 0; };
  c.Timer = vm.defineClass({
    name: 'flash.utils::Timer', base: c.EventDispatcher,
    allocate: (klass) => Object.assign(new ASObject(klass), { timer: { delay: 0, repeat: 0, count: 0, id: 0 } }),
    construct: (self, [delay, repeatCount = 0]) => {
      const ms = num(delay);
      if (!(ms >= 0) || !Number.isFinite(ms)) vm.throwError('RangeError', 2066, 'The Timer delay specified is out of range.');
      Object.assign(self.timer, { delay: ms, repeat: vm.toInt32(repeatCount) });
    },
    getters: {
      delay: (self) => self.timer.delay, repeatCount: (self) => self.timer.repeat, currentCount: (self) => self.timer.count, running: (self) => self.timer.id !== 0,
    },
    setters: {
      delay: (self, v) => { self.timer.delay = num(v); if (self.timer.id) { stopTimer(self); vm.callProperty(self, publicName('start'), []); } },
      repeatCount: (self, v) => { self.timer.repeat = vm.toInt32(v); },
    },
    methods: {
      start: (self) => {
        const t = self.timer;
        if (t.id) return;
        t.id = addTimer(t.delay, false, () => {
          t.count++;
          dispatch(self, vm.construct(c.TimerEvent, ['timer']));
          if (t.repeat > 0 && t.count >= t.repeat && t.id) {
            stopTimer(self);
            dispatch(self, vm.construct(c.TimerEvent, ['timerComplete']));
          }
        });
      },
      stop: (self) => { stopTimer(self); },
      reset: (self) => { stopTimer(self); self.timer.count = 0; },
    },
  });

  // --- flash.net / flash.utils / flash.system ---
  c.URLRequest = vm.defineClass({
    name: 'flash.net::URLRequest',
    construct: (self, [url]) => { self.url = url === undefined || url === null ? null : str(url); },
    getters: {
      url: (self) => self.url ?? null, method: (self) => self.method ?? 'GET', data: (self) => self.data ?? null,
      contentType: (self) => self.contentType ?? null, digest: (self) => self.digest ?? null,
      requestHeaders: (self) => (self.requestHeaders ??= new ASArray(vm, [])),
    },
    setters: {
      url: (self, v) => { self.url = v === null || v === undefined ? null : str(v); }, method: (self, v) => { self.method = str(v); }, data: (self, v) => { self.data = v; },
      contentType: (self, v) => { self.contentType = v === null || v === undefined ? null : str(v); },
      digest: (self, v) => { self.digest = v === null || v === undefined ? null : str(v); },
      requestHeaders: (self, v) => { self.requestHeaders = v instanceof ASArray ? v : new ASArray(vm, []); },
    },
  });
  // navigateToURL と sendToURL で送れるのは、単純なヘッダ（Accept、Accept-Language、Content-Language と、値が
  // application/x-www-form-urlencoded・multipart/form-data・text/plain の Content-Type）だけ。ほかは SecurityError（実機で確認）。
  const SIMPLE_HEADERS = new Set(['accept', 'accept-language', 'content-language']);
  const SIMPLE_TYPES = new Set(['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']);
  vm.requestHeaders = (request) => (request.requestHeaders instanceof ASArray ? request.requestHeaders.items : [])
    .filter((h) => h instanceof ASObject).map((h) => [str(vm.getProperty(h, vm.keyName('name'))), str(vm.getProperty(h, vm.keyName('value')))]);
  vm.simpleOnly = (request) => {
    const simpleType = (value) => SIMPLE_TYPES.has(value.split(';')[0].trim().toLowerCase());
    const bad = vm.requestHeaders(request).some(([name, value]) => (name.toLowerCase() === 'content-type' ? !simpleType(value) : !SIMPLE_HEADERS.has(name.toLowerCase())))
      || (request.contentType !== undefined && request.contentType !== null && !simpleType(request.contentType));
    if (bad) vm.throwError('SecurityError', 3769, 'Security sandbox violation: Only simple headers can be used with navigateToUrl() or sendToUrl().');
  };
  // 要求を記録して、移動はホストに任せる（AVM1 の getURL と同じ扱い）。
  vm.defineGlobal('flash.net::navigateToURL', vm.native((_, [request, window]) => {
    if (!(request instanceof ASObject) || request.klass !== c.URLRequest) vm.throwError('TypeError', 2007, 'Parameter request must be non-null.');
    vm.simpleOnly(request);
    const req = { kind: 'navigateToURL', url: request.url ?? '', target: window === undefined || window === null ? '' : str(window), method: request.method ?? 'GET' };
    movie.request(req);
    movie.navigate({ ...req, data: request.data === undefined || request.data === null ? '' : str(request.data) });
  }, 'navigateToURL'));
  vm.defineGlobal('flash.utils::getTimer', vm.native(() => Math.floor(vm.now()), 'getTimer'));
  vm.defineGlobal('flash.utils::getQualifiedClassName', vm.native((_, [v]) => (v instanceof ASClass ? v.name : vm.classOf(v)?.name ?? (v === null ? 'null' : 'void')), 'getQualifiedClassName'));
  vm.defineGlobal('flash.utils::getDefinitionByName', vm.native((_, [name]) => {
    const klass = vm.classByName(str(name).replace('::', '.'));
    if (!klass) vm.throwError('ReferenceError', 1065, `Variable ${str(name)} is not defined.`);
    return klass;
  }, 'getDefinitionByName'));
  vm.defineClass({
    name: 'flash.system::Security', final: true,
    staticValues: { sandboxType: 'localWithFile', LOCAL_WITH_FILE: 'localWithFile', LOCAL_WITH_NETWORK: 'localWithNetwork', LOCAL_TRUSTED: 'localTrusted', REMOTE: 'remote' },
    staticMethods: { allowDomain: () => {}, allowInsecureDomain: () => {}, loadPolicyFile: () => {} },
  });
  installNet(vm, movie);
  installVideo(vm, movie, media.gainOf);
  void ASArray;
}
