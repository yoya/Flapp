// flash.utils の入れ物: Dictionary。
import { ASObject } from './object.js';

export function installUtils(vm) {
  const c = vm.classes;
  // Dictionary: オブジェクトそのものをキーにできる（比較は同一性）。キーが数値や文字列のときは、ふつうの動的なプロパティになる。
  // オブジェクトのキーは dict に持ち、参照の振り分けは vm.js（getProperty など）が行う。弱参照の指定は無視する。
  c.Dictionary = vm.defineClass({
    name: 'flash.utils::Dictionary', dynamic: true,
    allocate: (klass) => Object.assign(new ASObject(klass), { dict: new Map() }),
    construct: () => {},
  });
}
