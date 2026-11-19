// flash.filters のクラスと、MovieClip.filters（SWF 8 から。定義は player/filterspec.js）。AS3 版は avm2/filters.js。
//
// フィルタのオブジェクトは、プロパティの値を self.fprops（JS のオブジェクト）に持つ。filters に代入したときは、その時点の値を
// 表示オブジェクトのフィルタ（desc）に写す。filters を読むと、そのたびに新しいオブジェクトの配列を返す。
import { FILTER_CLASS, FILTER_SPECS, coerceProp } from '../player/filterspec.js';
import { toBool, toNumber, toStr } from './convert.js';
import { AVMArray, AVMObject, DONT_DELETE, DONT_ENUM } from './object.js';

const HIDDEN = DONT_ENUM | DONT_DELETE;
const MAX_FILTERS = 64; // filters に入れられる数の上限

export function installFilters(vm) {
  const protos = new Map(); // クラス名 → プロトタイプ
  const flash = new AVMObject(vm, vm.objectProto);
  const filters = new AVMObject(vm, vm.objectProto);
  vm.global.define('flash', flash, DONT_ENUM);
  flash.define('filters', filters, HIDDEN);

  const fromScript = (spec, v) => {
    switch (spec.kind) {
      case 'list': return v instanceof AVMArray ? v.items.map((x) => toNumber(vm, x)) : [];
      case 'type': return v === undefined || v === null ? spec.def : toStr(vm, v);
      case 'bool': return toBool(vm, v);
      default: return toNumber(vm, v);
    }
  };
  const toScript = (spec, v) => (spec.kind === 'list' ? new AVMArray(vm, [...v]) : v);
  // グラデーションの alphas と ratios は、色の数までしか読めず、alpha は 1/255 刻み（AS3 の実機で確認）。
  const read = (spec, props, key) => {
    const v = props[key];
    if (props.colors === undefined || !Array.isArray(v) || (key !== 'alphas' && key !== 'ratios')) return toScript(spec.props[key], v);
    const cut = v.slice(0, props.colors.length);
    return new AVMArray(vm, key === 'alphas' ? cut.map((a) => Math.trunc(Math.min(Math.max(a, 0), 1) * 255) / 255) : cut);
  };

  for (const [name, spec] of Object.entries(FILTER_SPECS)) {
    const names = Object.keys(spec.props);
    const proto = new AVMObject(vm, vm.objectProto);
    protos.set(name, proto);
    // AS2 の alpha は 0〜1（AS3 と同じ）。AS2 の実機は未確認で、AS3 の規則を使っている。
    for (const key of names) {
      proto.defineAccessor(key, vm.native((_, self) => (self?.fprops ? read(spec, self.fprops, key) : undefined)), vm.native((_, self, [v]) => {
        if (!self?.fprops) return;
        self.fprops[key] = coerceProp(spec.props[key], fromScript(spec.props[key], v));
        spec.fix?.(self.fprops);
      }), HIDDEN);
    }
    const build = (args) => {
      const obj = new AVMObject(vm, proto);
      obj.fprops = {};
      names.forEach((key, i) => {
        const p = spec.props[key];
        const v = args[i];
        const none = v === undefined || v === null;
        obj.fprops[key] = none ? (Array.isArray(p.def) ? [...p.def] : p.def) : coerceProp(p, fromScript(p, v));
      });
      // AS2 の既定の角度は、45 ではなく 44.9999999772279 と読める（実機で確認。作られ方は分からないので、値をそのまま使う）。
      if (args[names.indexOf('angle')] === undefined && 'angle' in obj.fprops) obj.fprops.angle = 44.9999999772279;
      spec.fix?.(obj.fprops);
      return obj;
    };
    proto.define('clone', vm.native((_, self) => build(names.map((key) => (self?.fprops ? read(spec, self.fprops, key) : undefined)))), HIDDEN);
    const ctor = vm.native((_, __, args) => build(args), (_vm, args) => build(args));
    ctor.define('prototype', proto, HIDDEN);
    proto.define('constructor', ctor, HIDDEN);
    filters.define(name, ctor, DONT_ENUM);
  }

  const specOf = (obj) => {
    if (!(obj instanceof AVMObject) || !obj.fprops) return null;
    for (const [name, proto] of protos) if (obj.proto === proto) return FILTER_SPECS[name];
    return null;
  };

  // MovieClip.filters（SWF 8 から）。配列の要素にフィルタでないものがあれば、その要素は読み飛ばす。
  vm.movieClipProto.defineAccessor('filters', vm.native((_, self) => {
    if (vm.version < 8 || !self?.clip) return undefined;
    const out = (self.clip.filters ?? []).flatMap((d) => {
      const name = FILTER_CLASS[d.type];
      if (!name) return [];
      const spec = FILTER_SPECS[name];
      const obj = new AVMObject(vm, protos.get(name));
      obj.fprops = {};
      const props = spec.fromDesc(d);
      for (const key of Object.keys(spec.props)) obj.fprops[key] = props[key];
      return [obj];
    });
    return new AVMArray(vm, out);
  }), vm.native((_, self, [value]) => {
    if (vm.version < 8 || !self?.clip) return;
    const descs = [];
    if (value instanceof AVMArray) {
      for (const item of value.items.slice(0, MAX_FILTERS)) {
        const spec = specOf(item);
        if (spec) descs.push(spec.toDesc(item.fprops));
      }
    }
    self.clip.filters = descs.length ? descs : null;
    self.clip.scriptedFilters = true;
  }), HIDDEN);
}
