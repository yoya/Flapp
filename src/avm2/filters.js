// flash.filters のクラスと、DisplayObject.filters（定義は player/filterspec.js）。
//
// フィルタのオブジェクトは、プロパティの値を self.fprops（JS のオブジェクト）に持つ。filters に代入したときは、その時点の値を
// 表示オブジェクトのフィルタ（desc）に写す。あとでオブジェクトのプロパティを変えても、表示は変わらない（実機と同じ）。
// filters を読むと、そのたびに新しいオブジェクトの配列を返す。
import { FILTER_CLASS, FILTER_SPECS, coerceProp } from '../player/filterspec.js';
import { ASArray, ASObject, publicKey } from './object.js';

const MAX_FILTERS = 64; // filters に入れられる数の上限

export function installFilters(vm) {
  const c = vm.classes;
  const num = (v) => vm.toNumber(v);
  const classes = new Map(); // クラス名 → ASClass
  c.BitmapFilter = vm.defineClass({ name: 'flash.filters::BitmapFilter', methods: { clone: () => null } });

  // スクリプトの値を、プロパティの型に合わせた JS の値にする。
  const fromScript = (spec, v) => {
    switch (spec.kind) {
      case 'any': return v instanceof ASObject ? v : null;
      case 'point': return v instanceof ASObject ? { x: Math.trunc(num(v.values.get(publicKey('x')))) || 0, y: Math.trunc(num(v.values.get(publicKey('y')))) || 0 } : { x: 0, y: 0 }; // 整数に切り捨てる（実機で確認）
      case 'mode': {
        const s = vm.toStr(v);
        if (!spec.values.includes(s)) vm.throwError('ArgumentError', 2008, 'Parameter mode must be one of the accepted values.');
        return s;
      }
      case 'list': return v instanceof ASArray ? v.items.map((x) => num(x)) : [];
      case 'type': return v === undefined || v === null ? spec.def : vm.toStr(v);
      case 'bool': return vm.toBoolean(v);
      default: return num(v);
    }
  };
  // 読むと、点は新しい Point、ビットマップは複製（どちらも、持っているものとは別のオブジェクト。実機で確認）。
  const toScript = (spec, v) => {
    if (spec.kind === 'list') return new ASArray(vm, [...v]);
    if (spec.kind === 'point') return vm.construct(c.Point, [v.x, v.y]);
    if (spec.kind === 'any' && v?.bitmap) return Object.assign(new ASObject(v.klass), { bitmap: { ...v.bitmap, rgba: v.bitmap.rgba && new Uint8ClampedArray(v.bitmap.rgba), version: 0 } });
    return v;
  };
  // グラデーションの alphas と ratios は、色の数までしか読めず、alpha は 1/255 刻み（実機で確認）。
  const read = (spec, props, key) => {
    const v = props[key];
    if (props.colors === undefined || !Array.isArray(v) || (key !== 'alphas' && key !== 'ratios')) return toScript(spec.props[key], v);
    const cut = v.slice(0, props.colors.length);
    return new ASArray(vm, key === 'alphas' ? cut.map((a) => Math.trunc(Math.min(Math.max(a, 0), 1) * 255) / 255) : cut);
  };

  for (const [name, spec] of Object.entries(FILTER_SPECS)) {
    const names = Object.keys(spec.props);
    const getters = {}, setters = {};
    for (const key of names) {
      getters[key] = (self) => read(spec, self.fprops, key);
      setters[key] = (self, v) => {
        // null は代入できない（種類と配列。実機は TypeError #2007）。
        if ((v === null || v === undefined) && ['list', 'type', 'mode'].includes(spec.props[key].kind)) vm.throwError('TypeError', 2007, `Parameter ${key} must be non-null.`);
        self.fprops[key] = coerceProp(spec.props[key], fromScript(spec.props[key], v));
        spec.fix?.(self.fprops);
      };
    }
    const init = (self, args) => {
      self.fprops = {};
      names.forEach((key, i) => {
        const p = spec.props[key];
        const v = args[i];
        const none = v === undefined || v === null; // コンストラクタの null は、省略と同じ
        self.fprops[key] = none ? (Array.isArray(p.def) ? [...p.def] : p.def && typeof p.def === 'object' ? { ...p.def } : p.def) : coerceProp(p, fromScript(p, v));
      });
      spec.fix?.(self.fprops);
    };
    classes.set(name, vm.defineClass({
      name: `flash.filters::${name}`, base: c.BitmapFilter,
      allocate: (klass) => Object.assign(new ASObject(klass), { fprops: {} }),
      construct: init,
      getters, setters,
      methods: { clone: (self) => vm.construct(classes.get(name), names.map((key) => read(spec, self.fprops, key))) },
    }));
  }

  vm.defineClass({ name: 'flash.filters::DisplacementMapFilterMode', final: true, staticValues: { WRAP: 'wrap', CLAMP: 'clamp', IGNORE: 'ignore', COLOR: 'color' } });

  const specOf = (obj) => {
    for (const [name, klass] of classes) if (obj instanceof ASObject && obj.klass === klass) return FILTER_SPECS[name];
    return null;
  };

  // BitmapData.applyFilter が使う: フィルタのオブジェクトを desc にする（フィルタでなければ null）。
  vm.filterDesc = (obj) => { const spec = specOf(obj); return spec ? spec.toDesc(obj.fprops) : null; };

  return {
    /** 表示オブジェクトのフィルタ（desc の配列）から、新しいオブジェクトの配列を作る。 */
    read(descs) {
      const out = (descs ?? []).flatMap((d) => {
        const name = FILTER_CLASS[d.type];
        if (!name) return [];
        const spec = FILTER_SPECS[name];
        const obj = Object.assign(new ASObject(classes.get(name)), { fprops: {} });
        const props = spec.fromDesc(d);
        for (const key of Object.keys(spec.props)) obj.fprops[key] = props[key];
        return [obj];
      });
      return new ASArray(vm, out);
    },
    /** filters に代入された配列から、desc の配列を作る（null や空なら null）。 */
    write(value) {
      if (!(value instanceof ASArray)) return null;
      const descs = [];
      for (const item of value.items.slice(0, MAX_FILTERS)) {
        const spec = specOf(item);
        if (!spec) vm.throwError('ArgumentError', 2005, 'Error #2005: Parameter 0 is of the incorrect type. Should be type Filter.'); // 番号は、どの要素でも 0（実機で確認）
        descs.push(spec.toDesc(item.fprops));
      }
      return descs.length ? descs : null;
    },
  };
}
