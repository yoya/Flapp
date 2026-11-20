// ContextMenu・ContextMenuItem と flash.external.ExternalInterface（AS2）。メニューは表示しない（ブラウザの右クリックのメニューには
// つながらない）が、スクリプトが組み立てられる。ExternalInterface は使えない（available は偽。実機のスタンドアロン版と同じ）。
// 値は実機で確認（test/as/ctxmenu.as）。
import { toBool, toStr } from './convert.js';
import { defineClass, defineMethods } from './globals.js';
import { AVMArray, AVMObject, DONT_DELETE, DONT_ENUM } from './object.js';

const HIDDEN = DONT_ENUM | DONT_DELETE;
const BUILT_IN = ['forward_back', 'loop', 'play', 'print', 'quality', 'rewind', 'save', 'zoom'];

export function installMenu(vm) {
  const menuProto = new AVMObject(vm, vm.objectProto);
  const itemProto = new AVMObject(vm, vm.objectProto);
  const builtIns = (from) => {
    const out = new AVMObject(vm, vm.objectProto);
    for (const name of BUILT_IN) out.set(name, from ? from.get(name) : true);
    return out;
  };
  const newMenu = (onSelect, builtIn = null) => {
    const menu = new AVMObject(vm, menuProto);
    menu.set('builtInItems', builtIns(builtIn));
    menu.set('customItems', new AVMArray(vm, []));
    if (onSelect !== undefined) menu.set('onSelect', onSelect);
    return menu;
  };
  const newItem = (caption, onSelect, separatorBefore = false, enabled = true, visible = true) => {
    const item = new AVMObject(vm, itemProto);
    item.set('caption', caption === undefined ? undefined : toStr(vm, caption));
    if (onSelect !== undefined) item.set('onSelect', onSelect);
    item.set('separatorBefore', toBool(vm, separatorBefore));
    item.set('enabled', toBool(vm, enabled));
    item.set('visible', toBool(vm, visible));
    return item;
  };
  const copyItem = (item) => newItem(item.get('caption'), item.get('onSelect'), item.get('separatorBefore'), item.get('enabled'), item.get('visible'));
  defineMethods(vm, menuProto, {
    hideBuiltInItems: (_, self) => { const b = self.get('builtInItems'); if (b instanceof AVMObject) for (const name of BUILT_IN) b.set(name, false); },
    // 写しの項目は、項目そのものも写す（元と同じオブジェクトではない）。
    copy: (_, self) => {
      const menu = newMenu(self.get('onSelect'), self.get('builtInItems') instanceof AVMObject ? self.get('builtInItems') : null);
      const items = self.get('customItems');
      if (items instanceof AVMArray) menu.get('customItems').items.push(...items.items.map((it) => (it instanceof AVMObject ? copyItem(it) : it)));
      return menu;
    },
  });
  defineMethods(vm, itemProto, { copy: (_, self) => copyItem(self) });
  defineClass(vm, 'ContextMenu', menuProto, () => undefined, (_, [onSelect]) => newMenu(onSelect));
  defineClass(vm, 'ContextMenuItem', itemProto, () => undefined, (_, args) => newItem(...args));

  // flash.external.ExternalInterface
  let flash = vm.global.get('flash');
  if (!(flash instanceof AVMObject)) { flash = new AVMObject(vm, vm.objectProto); vm.global.define('flash', flash, DONT_ENUM); }
  const external = new AVMObject(vm, vm.objectProto);
  flash.define('external', external, HIDDEN);
  const ei = vm.native(() => undefined, () => undefined);
  defineMethods(vm, ei, { call: () => null, addCallback: () => false });
  ei.define('available', false, HIDDEN);
  external.define('ExternalInterface', ei, HIDDEN);
}
