// AVM2 の命令の実行。1 回の呼び出しごとに、局所変数・演算スタック・スコープスタックを持つ。
import { ASArray, ASClass, ASFunction, ASObject, ASThrown, AVM2LimitError, publicKey } from './object.js';
import { decodeCode } from './ops.js';

// メソッド本体を、分岐先を命令の番号に直した形にする（最初の実行時に 1 回だけ）。
function compile(body) {
  const ins = decodeCode(body.code);
  const indexAt = new Map(ins.map((x, i) => [x.at, i]));
  indexAt.set(body.code.length, ins.length);
  const target = (offset) => indexAt.get(offset) ?? ins.length; // 命令の境界でない分岐先は、末尾（= 終了）として扱う
  for (const x of ins) {
    if (x.name === 'lookupswitch') x.targets = x.args.map(target);
    else if (x.name === 'jump' || x.name.startsWith('if')) x.target = target(x.args[0]);
  }
  const handlers = body.exceptions.map((e) => ({ ...e, targetIndex: target(e.target) }));
  return { ins, handlers };
}

/**
 * スクリプトの関数 fn を実行する。
 * @param {import('./vm.js').AVM2} vm
 * @param {ASFunction} fn
 */
export function execute(vm, fn, thisValue, args) {
  const { method } = fn;
  const { body } = method;
  const { abc } = method;
  const { ins, handlers } = (body.compiled ??= compile(body));

  // 局所変数: 0 番が this、続いて引数、その次に残りの引数の配列（または arguments）。
  const locals = new Array(Math.max(body.localCount, method.paramTypes.length + 2)).fill(undefined);
  locals[0] = thisValue;
  const count = method.paramTypes.length;
  for (let i = 0; i < count; i++) {
    let v;
    if (i < args.length) v = vm.coerceByName(abc, method.paramTypes[i], args[i]);
    else {
      const k = i - (count - method.optional.length);
      if (k < 0) vm.throwError('ArgumentError', 1063, `Argument count mismatch on ${fn.fnName || 'function'}(). Expected ${count - method.optional.length}, got ${args.length}.`);
      v = method.optional[k];
    }
    locals[i + 1] = v;
  }
  if (method.needRest) locals[count + 1] = new ASArray(vm, args.slice(count));
  else if (method.needArguments) locals[count + 1] = new ASArray(vm, args.slice());

  let stack = [];
  let scopes = []; // { object, with }
  const saved = fn.scope;
  const pop = () => stack.pop();
  const popArgs = (n) => (n === 0 ? [] : stack.splice(stack.length - n, n));
  const name = (index) => vm.resolveName(abc, index, stack);
  const globalObject = () => (saved[0] ?? scopes[0])?.object;
  // 名前を持つスコープ上のオブジェクトを探す。with で積んだものと大域オブジェクトは動的なプロパティも見る。
  const find = (rn, strict) => {
    for (const list of [scopes, saved]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        if (s.with || s.object?.klass?.name === 'global' ? vm.hasProperty(s.object, rn) : vm.hasTrait(s.object, rn)) return s.object;
      }
    }
    const holder = vm.globalHolder(rn.keys);
    if (holder) return holder;
    if (strict) vm.throwError('ReferenceError', 1065, `Variable ${rn.name} is not defined.`);
    return globalObject();
  };
  const superClass = () => fn.owner?.superClass ?? null;
  const superTrait = (rn) => {
    const base = superClass();
    if (base) for (const key of rn.keys) { const t = base.instanceTraits.get(key); if (t) return t; }
    return undefined;
  };
  const slotKey = (obj, n) => (obj instanceof ASClass ? obj.staticSlotKeys : obj?.klass?.slotKeys)?.[n];
  const typeFor = (index) => {
    const rn = name(index);
    const holder = vm.globalHolder(rn.keys);
    for (const key of rn.keys) { const v = holder?.values.get(key); if (v instanceof ASClass) return v; }
    return undefined;
  };

  let pc = 0;
  for (;;) {
    try {
      while (pc < ins.length) {
        if (--vm.steps < 0) throw new AVM2LimitError('script runs too long');
        const x = ins[pc++];
        const a = x.args;
        switch (x.op) {
          // --- 何もしない命令 ---
          case 0x01: case 0x02: case 0x09: case 0xef: case 0xf0: case 0xf1: case 0xf2: case 0xf3: break;

          // --- 局所変数 ---
          case 0xd0: case 0xd1: case 0xd2: case 0xd3: stack.push(locals[x.op - 0xd0]); break;
          case 0xd4: case 0xd5: case 0xd6: case 0xd7: locals[x.op - 0xd4] = pop(); break;
          case 0x62: stack.push(locals[a[0]]); break;
          case 0x63: locals[a[0]] = pop(); break;
          case 0x08: locals[a[0]] = undefined; break; // kill
          case 0x92: locals[a[0]] = vm.toNumber(locals[a[0]]) + 1; break;
          case 0x94: locals[a[0]] = vm.toNumber(locals[a[0]]) - 1; break;
          case 0xc2: locals[a[0]] = (vm.toInt32(locals[a[0]]) + 1) | 0; break;
          case 0xc3: locals[a[0]] = (vm.toInt32(locals[a[0]]) - 1) | 0; break;

          // --- 値を積む ---
          case 0x20: stack.push(null); break;
          case 0x21: stack.push(undefined); break;
          case 0x24: case 0x25: stack.push(x.op === 0x25 ? (a[0] << 16) >> 16 : a[0]); break; // pushbyte / pushshort
          case 0x26: stack.push(true); break;
          case 0x27: stack.push(false); break;
          case 0x28: stack.push(NaN); break;
          case 0x2c: stack.push(abc.strings[a[0]] ?? ''); break;
          case 0x2d: stack.push(abc.ints[a[0]] ?? 0); break;
          case 0x2e: stack.push(abc.uints[a[0]] ?? 0); break;
          case 0x2f: stack.push(abc.doubles[a[0]] ?? NaN); break;
          case 0x31: stack.push(vm.newNamespace(abc.namespaces[a[0]])); break;
          case 0x29: pop(); break;
          case 0x2a: stack.push(stack[stack.length - 1]); break;
          case 0x2b: { const b = pop(), c = pop(); stack.push(b, c); break; }

          // --- スコープ ---
          case 0x30: scopes.push({ object: pop(), with: false }); break;
          case 0x1c: scopes.push({ object: pop(), with: true }); break;
          case 0x1d: scopes.pop(); break;
          case 0x64: stack.push(globalObject()); break;
          case 0x65: stack.push(scopes[a[0]]?.object); break;
          case 0x57: stack.push(vm.newActivation(abc, body)); break;
          case 0x5a: stack.push(vm.newCatch(abc, body.exceptions[a[0]])); break;

          // --- 名前の検索とプロパティ ---
          case 0x5d: stack.push(find(name(a[0]), true)); break;
          case 0x5e: stack.push(find(name(a[0]), false)); break;
          case 0x5f: { const rn = name(a[0]); stack.push(vm.globalHolder(rn.keys) ?? globalObject()); break; }
          case 0x60: { const rn = name(a[0]); stack.push(vm.getProperty(find(rn, true), rn)); break; }
          case 0x66: { const rn = name(a[0]); stack.push(vm.getProperty(pop(), rn)); break; }
          case 0x61: case 0x68: { const v = pop(); const rn = name(a[0]); vm.setProperty(pop(), rn, v, x.op === 0x68); break; }
          case 0x6a: { const rn = name(a[0]); stack.push(vm.deleteProperty(pop(), rn)); break; }
          case 0x6c: { const obj = pop(); stack.push(obj?.values?.get(slotKey(obj, a[0]))); break; }
          case 0x6d: { const v = pop(); const obj = pop(); const key = slotKey(obj, a[0]); if (key !== undefined) obj.values.set(key, v); break; }
          case 0x6e: { const g = globalObject(); stack.push(g?.values.get(slotKey(g, a[0]))); break; }
          case 0x6f: { const g = globalObject(); const key = slotKey(g, a[0]); if (key !== undefined) g.values.set(key, pop()); else pop(); break; }
          case 0x04: { // getsuper
            const rn = name(a[0]);
            const obj = pop();
            const t = superTrait(rn);
            stack.push(!t ? undefined : t.kind === 'accessor' ? (t.get ? vm.call(t.get, obj, []) : undefined) : t.kind === 'method' ? t.fn : obj.values.get(t.key));
            break;
          }
          case 0x05: { // setsuper
            const v = pop();
            const rn = name(a[0]);
            const obj = pop();
            const t = superTrait(rn);
            if (t?.kind === 'accessor' && t.set) vm.call(t.set, obj, [v]);
            else if (t?.kind === 'slot') obj.values.set(t.key, v);
            break;
          }

          // --- 呼び出しと生成 ---
          case 0x46: case 0x4c: case 0x4f: { // callproperty / callproplex / callpropvoid
            const list = popArgs(a[1]);
            const rn = name(a[0]);
            const result = vm.callProperty(pop(), rn, list);
            if (x.op !== 0x4f) stack.push(result);
            break;
          }
          case 0x41: { const list = popArgs(a[0]); const receiver = pop(); stack.push(vm.call(pop(), receiver, list)); break; }
          case 0x42: { const list = popArgs(a[0]); stack.push(vm.construct(pop(), list)); break; }
          case 0x4a: { // constructprop
            const list = popArgs(a[1]);
            const rn = name(a[0]);
            stack.push(vm.construct(vm.getProperty(pop(), rn), list));
            break;
          }
          case 0x49: { // constructsuper
            const list = popArgs(a[0]);
            const obj = pop();
            const base = superClass();
            if (base?.constructorFn) vm.call(base.constructorFn, obj, list);
            break;
          }
          case 0x45: case 0x4e: { // callsuper / callsupervoid
            const list = popArgs(a[1]);
            const rn = name(a[0]);
            const obj = pop();
            const t = superTrait(rn);
            if (t?.kind !== 'method') vm.throwError('TypeError', 1006, `${rn.name} is not a function.`);
            const result = vm.call(t.fn, obj, list);
            if (x.op === 0x45) stack.push(result);
            break;
          }
          case 0x43: case 0x44: vm.throwError('VerifyError', 1051, 'Illegal early binding access.'); break; // callmethod / callstatic
          case 0x40: { // newfunction
            const f = new ASFunction(vm, { method: abc.methods[a[0]], scope: [...saved, ...scopes] });
            const proto = new ASObject(vm.classes.Object);
            f.values.set(publicKey('prototype'), proto);
            stack.push(f);
            break;
          }
          case 0x58: stack.push(vm.createClass(abc, a[0], pop(), [...saved, ...scopes])); break;
          case 0x55: { // newobject
            const list = popArgs(a[0] * 2);
            const obj = new ASObject(vm.classes.Object);
            for (let i = 0; i < list.length; i += 2) obj.values.set(publicKey(vm.toStr(list[i])), list[i + 1]);
            stack.push(obj);
            break;
          }
          case 0x56: stack.push(new ASArray(vm, popArgs(a[0]))); break;
          case 0x53: { popArgs(a[0]); break; } // applytype: 型引数は使わない（Vector.<T> は Vector として扱う）
          case 0x47: return undefined;
          case 0x48: return vm.coerceByName(abc, method.returnType, pop());
          case 0x03: throw new ASThrown(pop());

          // --- 型変換 ---
          case 0x70: stack.push(vm.toStr(pop())); break;
          case 0x85: { const v = pop(); stack.push(v === null || v === undefined ? null : vm.toStr(v)); break; }
          case 0x73: case 0x83: stack.push(vm.toInt32(pop())); break;
          case 0x74: case 0x88: stack.push(vm.toUint32(pop())); break;
          case 0x75: case 0x84: stack.push(vm.toNumber(pop())); break;
          case 0x76: case 0x81: stack.push(vm.toBoolean(pop())); break;
          case 0x77: { const v = stack[stack.length - 1]; if (v === null || v === undefined) vm.throwError('TypeError', v === null ? 1009 : 1010, 'Cannot access a property or method of a null object reference.'); break; }
          case 0x82: break; // coerce_a
          case 0x89: { const v = pop(); stack.push(v === undefined ? null : v); break; }
          case 0x80: stack.push(vm.coerceByName(abc, a[0], pop())); break;
          case 0x86: { const v = pop(); const t = typeFor(a[0]); stack.push(t && vm.isType(v, t) ? v : null); break; }
          case 0x87: { const t = pop(); const v = pop(); stack.push(vm.isType(v, t) ? v : null); break; }
          case 0xb2: { const v = pop(); const t = typeFor(a[0]); stack.push(!!t && vm.isType(v, t)); break; }
          case 0xb3: { const t = pop(); stack.push(vm.isType(pop(), t)); break; }
          case 0xb1: { // instanceof: 右辺の prototype が、左辺の prototype の連なりにあるか
            const t = pop();
            const v = pop();
            if (!(t instanceof ASClass) && !(t instanceof ASFunction)) vm.throwError('TypeError', 1040, 'The right-hand side of instanceof must be a class or function.');
            stack.push(t instanceof ASClass ? vm.isType(v, t) && !t.isInterface : false);
            break;
          }
          case 0x95: stack.push(vm.typeOf(pop())); break;
          case 0x50: stack.push((vm.toInt32(pop()) << 31) >> 31); break;
          case 0x51: stack.push((vm.toInt32(pop()) << 24) >> 24); break;
          case 0x52: stack.push((vm.toInt32(pop()) << 16) >> 16); break;

          // --- 演算 ---
          case 0xa0: { const b = pop(); stack.push(vm.add(pop(), b)); break; }
          case 0xa1: { const b = vm.toNumber(pop()); stack.push(vm.toNumber(pop()) - b); break; }
          case 0xa2: { const b = vm.toNumber(pop()); stack.push(vm.toNumber(pop()) * b); break; }
          case 0xa3: { const b = vm.toNumber(pop()); stack.push(vm.toNumber(pop()) / b); break; }
          case 0xa4: { const b = vm.toNumber(pop()); stack.push(vm.toNumber(pop()) % b); break; }
          case 0x90: stack.push(-vm.toNumber(pop())); break;
          case 0x91: stack.push(vm.toNumber(pop()) + 1); break;
          case 0x93: stack.push(vm.toNumber(pop()) - 1); break;
          case 0xc0: stack.push((vm.toInt32(pop()) + 1) | 0); break;
          case 0xc1: stack.push((vm.toInt32(pop()) - 1) | 0); break;
          case 0xc4: stack.push(-vm.toInt32(pop()) | 0); break;
          case 0xc5: { const b = vm.toInt32(pop()); stack.push((vm.toInt32(pop()) + b) | 0); break; }
          case 0xc6: { const b = vm.toInt32(pop()); stack.push((vm.toInt32(pop()) - b) | 0); break; }
          case 0xc7: { const b = vm.toInt32(pop()); stack.push(Math.imul(vm.toInt32(pop()), b)); break; }
          case 0xa5: { const b = vm.toUint32(pop()); stack.push(vm.toInt32(pop()) << (b & 31)); break; }
          case 0xa6: { const b = vm.toUint32(pop()); stack.push(vm.toInt32(pop()) >> (b & 31)); break; }
          case 0xa7: { const b = vm.toUint32(pop()); stack.push(vm.toUint32(pop()) >>> (b & 31)); break; }
          case 0xa8: { const b = vm.toInt32(pop()); stack.push(vm.toInt32(pop()) & b); break; }
          case 0xa9: { const b = vm.toInt32(pop()); stack.push(vm.toInt32(pop()) | b); break; }
          case 0xaa: { const b = vm.toInt32(pop()); stack.push(vm.toInt32(pop()) ^ b); break; }
          case 0x97: stack.push(~vm.toInt32(pop())); break;
          case 0x96: stack.push(!vm.toBoolean(pop())); break;
          case 0xab: { const b = pop(); stack.push(vm.equals(pop(), b)); break; }
          case 0xac: { const b = pop(); stack.push(pop() === b); break; }
          case 0xad: { const b = pop(); stack.push(vm.lessThan(pop(), b) === true); break; }
          case 0xae: { const b = pop(); stack.push(vm.lessThan(b, pop()) === false); break; }
          case 0xaf: { const b = pop(); stack.push(vm.lessThan(b, pop()) === true); break; }
          case 0xb0: { const b = pop(); stack.push(vm.lessThan(pop(), b) === false); break; }
          case 0xb4: { const obj = pop(); const key = pop(); stack.push(vm.hasProperty(obj, { name: typeof key === 'number' ? key : vm.toStr(key), keys: [publicKey(vm.toStr(key))], late: true })); break; }

          // --- 分岐 ---
          case 0x10: pc = x.target; break;
          case 0x11: if (vm.toBoolean(pop())) pc = x.target; break;
          case 0x12: if (!vm.toBoolean(pop())) pc = x.target; break;
          case 0x13: { const b = pop(); if (vm.equals(pop(), b)) pc = x.target; break; }
          case 0x14: { const b = pop(); if (!vm.equals(pop(), b)) pc = x.target; break; }
          case 0x15: { const b = pop(); if (vm.lessThan(pop(), b) === true) pc = x.target; break; }
          case 0x16: { const b = pop(); if (vm.lessThan(b, pop()) === false) pc = x.target; break; }
          case 0x17: { const b = pop(); if (vm.lessThan(b, pop()) === true) pc = x.target; break; }
          case 0x18: { const b = pop(); if (vm.lessThan(pop(), b) === false) pc = x.target; break; }
          case 0x0c: { const b = pop(); if (vm.lessThan(pop(), b) !== true) pc = x.target; break; }
          case 0x0d: { const b = pop(); if (vm.lessThan(b, pop()) !== false) pc = x.target; break; }
          case 0x0e: { const b = pop(); if (vm.lessThan(b, pop()) !== true) pc = x.target; break; }
          case 0x0f: { const b = pop(); if (vm.lessThan(pop(), b) !== false) pc = x.target; break; }
          case 0x19: { const b = pop(); if (pop() === b) pc = x.target; break; }
          case 0x1a: { const b = pop(); if (pop() !== b) pc = x.target; break; }
          case 0x1b: { const i = vm.toInt32(pop()); pc = x.targets[i >= 0 && i + 1 < x.targets.length ? i + 1 : 0]; break; }

          // --- 列挙 (for..in / for each) ---
          case 0x32: { // hasnext2: 局所変数のオブジェクトと位置を進める
            const names = vm.enumerate(locals[a[0]]);
            const i = vm.toInt32(locals[a[1]]);
            if (i < names.length) {
              locals[a[1]] = i + 1;
              stack.push(true);
            } else {
              locals[a[0]] = null;
              locals[a[1]] = 0;
              stack.push(false);
            }
            break;
          }
          case 0x1f: { const i = vm.toInt32(pop()); const obj = pop(); stack.push(i < vm.enumerate(obj).length ? i + 1 : 0); break; }
          case 0x1e: { const i = vm.toInt32(pop()); const obj = pop(); stack.push(vm.enumerate(obj)[i - 1]); break; }
          case 0x23: {
            const i = vm.toInt32(pop());
            const obj = pop();
            const key = vm.enumerate(obj)[i - 1];
            stack.push(key === undefined ? undefined : vm.getProperty(obj, { name: key, keys: [publicKey(key)], late: true }));
            break;
          }

          default:
            vm.throwError('VerifyError', 1011, `Method contains an unsupported opcode ${x.name}.`);
        }
      }
      return undefined;
    } catch (e) {
      // スクリプトが投げた値を、この命令を範囲に含む catch に渡す。無ければ呼び出し元へ。
      if (!(e instanceof ASThrown)) throw e;
      const at = ins[pc - 1]?.at ?? -1;
      const handler = handlers.find((h) => at >= h.from && at < h.to && (h.type === 0 || vm.isType(e.value, typeFor(h.type))));
      if (!handler) throw e;
      stack = [e.value];
      scopes = [];
      pc = handler.targetIndex;
    }
  }
}
