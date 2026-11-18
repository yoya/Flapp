// XML と XMLNode。
// ノードの中身は AVMObject の xml プロパティ（JS 側）に持つ: { type, name, value, attributes, children, parent }。
// type は 1 が要素（と文書そのもの）、3 が文字列。スクリプトからは XMLNode.prototype の getter / setter で読み書きする。
import { toBool, toInt32, toStr } from './convert.js';
import { defineClass, defineMethods } from './globals.js';
import { AVMArray, AVMFunction, AVMObject, DONT_DELETE, DONT_ENUM } from './object.js';

const HIDDEN = DONT_ENUM | DONT_DELETE;
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
const ESCAPES = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };
const unescapeText = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (all, name) => {
  if (name[0] !== '#') return ENTITIES[name] ?? all;
  const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
});
const escapeText = (s) => s.replace(/[<>&"']/g, (c) => ESCAPES[c]);
// 解析の結果（XML.status）。実機と同じ番号。
const STATUS = { ok: 0, cdata: -2, comment: -5, element: -6, unclosed: -9, unopened: -10 };
const MAX_NODES = 100000;

export function installXML(vm) {
  const nodeProto = new AVMObject(vm, vm.objectProto);
  const xmlProto = new AVMObject(vm, nodeProto);
  const data = (self) => (self instanceof AVMObject ? self.xml : undefined);
  const newNode = (type, value, proto = nodeProto) => {
    const obj = new AVMObject(vm, proto);
    obj.xml = {
      type, name: type === 1 ? value : null, value: type === 1 ? null : value,
      attributes: new AVMObject(vm, vm.objectProto), children: [], parent: null,
    };
    return obj;
  };
  const detach = (node) => {
    const parent = node.xml.parent;
    if (parent) parent.xml.children.splice(parent.xml.children.indexOf(node), 1);
    node.xml.parent = null;
  };
  const insert = (parent, node, at) => {
    detach(node);
    parent.xml.children.splice(Math.min(at, parent.xml.children.length), 0, node);
    node.xml.parent = parent;
  };

  // 文字列化。属性は attributes の列挙順（新しいものが先）。子の無い要素は <a />。
  const serialize = (node) => {
    const n = node.xml;
    if (n.type !== 1) return escapeText(n.value ?? '');
    const inner = n.children.map(serialize).join('');
    if (n.name === null) return `${n.xmlDecl ?? ''}${n.docTypeDecl ?? ''}${inner}`; // 文書
    const attrs = n.attributes.ownKeys().map((key) => ` ${key}="${escapeText(toStr(vm, n.attributes.get(key)))}"`).join('');
    return inner === '' && n.children.length === 0 ? `<${n.name}${attrs} />` : `<${n.name}${attrs}>${inner}</${n.name}>`;
  };

  // 文字列 text を解析して、文書 doc の子にする。途中で誤りがあれば、そこまでの木を残して status に理由を入れる。
  const parse = (doc, text, ignoreWhite) => {
    const d = doc.xml;
    for (const child of d.children) child.xml.parent = null;
    d.children = [];
    d.xmlDecl = d.docTypeDecl = undefined;
    d.status = STATUS.ok;
    const stack = [doc];
    let count = 0;
    const add = (node) => {
      if (++count > MAX_NODES) return;
      const parent = stack[stack.length - 1];
      parent.xml.children.push(node);
      node.xml.parent = parent;
    };
    const addText = (s) => {
      if (s === '' || (ignoreWhite && /^[ \t\r\n]*$/.test(s))) return;
      add(newNode(3, s));
    };
    let i = 0;
    while (i < text.length) {
      const lt = text.indexOf('<', i);
      if (lt < 0) {
        addText(unescapeText(text.slice(i)));
        break;
      }
      addText(unescapeText(text.slice(i, lt)));
      const skipTo = (end, status) => {
        const at = text.indexOf(end, lt);
        if (at < 0) d.status = status;
        return at < 0 ? -1 : at + end.length;
      };
      if (text.startsWith('<!--', lt)) {
        i = skipTo('-->', STATUS.comment);
      } else if (text.startsWith('<![CDATA[', lt)) {
        i = skipTo(']]>', STATUS.cdata);
        if (i >= 0) addText(text.slice(lt + 9, i - 3));
      } else if (text.startsWith('<?', lt)) {
        i = skipTo('?>', STATUS.element);
        if (i >= 0) d.xmlDecl = (d.xmlDecl ?? '') + text.slice(lt, i);
      } else if (text.startsWith('<!', lt)) {
        i = skipTo('>', STATUS.element);
        if (i >= 0) d.docTypeDecl = (d.docTypeDecl ?? '') + text.slice(lt, i);
      } else if (text[lt + 1] === '/') {
        const gt = text.indexOf('>', lt);
        const name = gt < 0 ? '' : text.slice(lt + 2, gt).trim();
        if (gt < 0) d.status = STATUS.element;
        else if (stack.length > 1 && stack[stack.length - 1].xml.name === name) stack.pop();
        // 開いている要素のどれかの終了タグなら「閉じていない要素がある」、どれでもなければ「開始タグが無い」。
        else d.status = stack.slice(1).some((node) => node.xml.name === name) ? STATUS.unclosed : STATUS.unopened;
        i = gt < 0 || d.status !== STATUS.ok ? -1 : gt + 1;
      } else {
        // 開始タグ: 名前、属性（値は引用符で囲む）、> または />
        const head = /^<([^\s/>]+)/.exec(text.slice(lt, lt + 1024));
        let p = head ? lt + head[0].length : -1;
        const node = head ? newNode(1, head[1]) : null;
        const attrs = [];
        let closed = false, selfClosing = false;
        while (p >= 0 && p < text.length) {
          const rest = /^\s*(\/?>|([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)'))/.exec(text.slice(p));
          if (!rest) break;
          p += rest[0].length;
          if (rest[2] === undefined) {
            closed = true;
            selfClosing = rest[1] === '/>';
            break;
          }
          attrs.push([rest[2], unescapeText(rest[4] ?? rest[5])]);
        }
        if (!node || !closed) {
          d.status = STATUS.element;
          i = -1;
        } else {
          // 後ろの属性から作る（列挙したときに書かれた順になる）。
          for (const [key, value] of attrs.reverse()) node.xml.attributes.set(key, value);
          add(node);
          if (!selfClosing) stack.push(node);
          i = p;
        }
      }
      if (i < 0) return;
    }
    if (stack.length > 1) d.status = STATUS.unclosed;
  };

  // --- XMLNode ---
  const accessor = (proto, name, get, set) => proto.defineAccessor(name, vm.native((_, self) => (data(self) ? get(data(self), self) : undefined)),
    set ? vm.native((_, self, [v]) => { if (data(self)) set(data(self), v); }) : null, HIDDEN);
  const sibling = (n, self, step) => {
    const list = n.parent?.xml.children;
    return list?.[list.indexOf(self) + step] ?? null;
  };
  accessor(nodeProto, 'nodeType', (n) => n.type);
  accessor(nodeProto, 'nodeName', (n) => n.name, (n, v) => { n.name = toStr(vm, v); });
  accessor(nodeProto, 'nodeValue', (n) => n.value, (n, v) => { n.value = toStr(vm, v); });
  accessor(nodeProto, 'attributes', (n) => n.attributes);
  accessor(nodeProto, 'childNodes', (n) => new AVMArray(vm, n.children.slice()));
  accessor(nodeProto, 'firstChild', (n) => n.children[0] ?? null);
  accessor(nodeProto, 'lastChild', (n) => n.children[n.children.length - 1] ?? null);
  accessor(nodeProto, 'parentNode', (n) => n.parent);
  accessor(nodeProto, 'nextSibling', (n, self) => sibling(n, self, 1));
  accessor(nodeProto, 'previousSibling', (n, self) => sibling(n, self, -1));
  const clone = (node, deep) => {
    const n = node.xml;
    const copy = newNode(n.type, n.type === 1 ? n.name : n.value);
    for (const key of n.attributes.ownKeys().reverse()) copy.xml.attributes.set(key, n.attributes.get(key));
    if (deep) for (const child of n.children) insert(copy, clone(child, true), Infinity);
    return copy;
  };
  defineMethods(vm, nodeProto, {
    hasChildNodes: (_, self) => (data(self)?.children.length ?? 0) > 0,
    // すでに自分の子になっているノードは動かさない（実機で確認）。
    appendChild: (_, self, [node]) => { if (data(self) && data(node) && node.xml.parent !== self && node !== self) insert(self, node, Infinity); },
    insertBefore: (_, self, [node, before]) => {
      if (!data(self) || !data(node) || node === self) return;
      const at = data(self).children.indexOf(before);
      if (at >= 0) insert(self, node, data(self).children.indexOf(before));
    },
    removeNode: (_, self) => { if (data(self)) detach(self); },
    cloneNode: (_, self, [deep]) => (data(self) ? clone(self, toBool(vm, deep)) : undefined),
    toString: (_, self) => (data(self) ? serialize(self) : ''),
  });
  defineClass(vm, 'XMLNode', nodeProto, () => undefined, (_, [type, value]) => newNode(toInt32(vm, type) === 1 ? 1 : 3, toStr(vm, value)));

  // --- XML（文書） ---
  accessor(xmlProto, 'status', (n) => n.status ?? 0);
  accessor(xmlProto, 'xmlDecl', (n) => n.xmlDecl, (n, v) => { n.xmlDecl = toStr(vm, v); });
  accessor(xmlProto, 'docTypeDecl', (n) => n.docTypeDecl, (n, v) => { n.docTypeDecl = toStr(vm, v); });
  accessor(xmlProto, 'ignoreWhite', (n) => n.ignoreWhite ?? false, (n, v) => { n.ignoreWhite = toBool(vm, v); });
  xmlProto.define('contentType', 'application/x-www-form-urlencoded', HIDDEN);
  const callMethod = (obj, name, args) => {
    const fn = obj.get(name);
    if (fn instanceof AVMFunction) vm.invoke(fn, obj, args);
  };
  // 読み込みは行わない。要求を記録し、次のフレームの後で失敗を伝える（net.js の LoadVars と同じ）。
  const startLoad = (self, url, method) => {
    if (!data(self) || url === undefined) return false;
    self.define('loaded', false, HIDDEN);
    vm.request({ kind: 'loadVariables', url: toStr(vm, url), target: '', method });
    vm.later(() => callMethod(self, 'onData', [undefined]));
    return true;
  };
  defineMethods(vm, xmlProto, {
    parseXML: (_, self, [text]) => { if (data(self)) parse(self, toStr(vm, text), data(self).ignoreWhite ?? false); },
    createElement: (_, __, [name]) => newNode(1, toStr(vm, name)),
    createTextNode: (_, __, [text]) => newNode(3, toStr(vm, text)),
    load: (_, self, [url]) => startLoad(self, url, ''),
    send: (_, self, [url]) => {
      if (url === undefined) return false;
      vm.request({ kind: 'getURL', url: toStr(vm, url), target: '', method: 'POST' });
      return true;
    },
    sendAndLoad: (_, self, [url, target]) => startLoad(target, url, 'POST'),
    getBytesLoaded: () => undefined,
    getBytesTotal: () => undefined,
    onData: (_, self, [text]) => {
      if (!data(self)) return;
      if (text === undefined) return callMethod(self, 'onLoad', [false]);
      parse(self, toStr(vm, text), data(self).ignoreWhite ?? false);
      self.define('loaded', true, HIDDEN);
      return callMethod(self, 'onLoad', [true]);
    },
    onLoad: () => undefined,
  });
  defineClass(vm, 'XML', xmlProto, () => undefined, (_, [text]) => {
    const doc = newNode(1, null, xmlProto);
    if (text !== undefined) parse(doc, toStr(vm, text), false);
    return doc;
  });
}
