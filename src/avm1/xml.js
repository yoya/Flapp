// XML と XMLNode。
// ノードの中身は AVMObject の xml プロパティ（JS 側）に持つ: { type, name, value, attributes, children, parent }。
// type は 1 が要素（と文書そのもの）、3 が文字列。スクリプトからは XMLNode.prototype の getter / setter で読み書きする。
import { toBool, toInt32, toStr } from './convert.js';
import { defineClass, defineMethods } from './globals.js';
import { AVMArray, AVMFunction, AVMObject, DONT_DELETE, DONT_ENUM } from './object.js';
import { escapeXML as escapeText, parseLegacyXML } from '../player/legacyxml.js';

const HIDDEN = DONT_ENUM | DONT_DELETE;
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: '\u00a0' };

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

  // 文字列 text を解析して、文書 doc の子にする。途中で誤りがあれば、そこまでの木を残して status に理由を入れる（player/legacyxml.js）。
  const parse = (doc, text, ignoreWhite) => {
    const d = doc.xml;
    for (const child of d.children) child.xml.parent = null;
    d.children = [];
    const result = parseLegacyXML(text, { ignoreWhite, entities: ENTITIES });
    d.xmlDecl = result.xmlDecl;
    d.docTypeDecl = result.docTypeDecl;
    d.status = result.status;
    const build = (plain, parent) => {
      const node = newNode(plain.type, plain.type === 1 ? plain.name : plain.value);
      // 後ろの属性から作る（列挙したときに書かれた順になる）。
      for (const [key, value] of [...plain.attrs].reverse()) node.xml.attributes.set(key, value);
      node.xml.parent = parent;
      parent.xml.children.push(node);
      for (const child of plain.children) build(child, node);
    };
    for (const child of result.children) build(child, doc);
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
  // 読み込みはホストに任せる（ホストが読まなければ、次のフレームの後で失敗を伝える。net.js の LoadVars と同じ）。
  // sender があれば、その XML を本文として送る（sendAndLoad）。
  const startLoad = (self, url, method, sender = null) => {
    if (!data(self) || url === undefined) return false;
    self.define('loaded', false, HIDDEN);
    const body = sender && data(sender) ? toStr(vm, sender) : '';
    const contentType = sender && data(sender) ? toStr(vm, sender.get('contentType')) : undefined;
    vm.loadText({ url: toStr(vm, url), method, body, contentType, headers: sender?.requestHeaders }, (text) => callMethod(self, 'onData', [text]));
    return true;
  };
  defineMethods(vm, xmlProto, {
    addRequestHeader: (_, self, args) => { vm.addRequestHeader(self, args); },
    parseXML: (_, self, [text]) => { if (data(self)) parse(self, toStr(vm, text), data(self).ignoreWhite ?? false); },
    createElement: (_, __, [name]) => newNode(1, toStr(vm, name)),
    createTextNode: (_, __, [text]) => newNode(3, toStr(vm, text)),
    load: (_, self, [url]) => startLoad(self, url, ''),
    send: (_, self, [url, target]) => {
      if (url === undefined) return false;
      const req = { kind: 'getURL', url: toStr(vm, url), target: '', method: 'POST' };
      vm.request(req);
      vm.navigate({ ...req, target: target === undefined ? '' : toStr(vm, target), data: data(self) ? toStr(vm, self) : '' });
      return true;
    },
    sendAndLoad: (_, self, [url, target]) => startLoad(target, url, 'POST', self),
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
