// flash.xml の XMLDocument・XMLNode・XMLNodeType（AS3 の古い形の XML）。解析は player/legacyxml.js（AS2 の XML と共通）。
// AS2 との違い（実機で確認。test/as3/xmldoc.as）: 壊れた XML は例外（#1090 など）、属性は名前の順に書き出す、ignoreWhite は残す文字列の
// 先頭の空白も削る、&nbsp; は U+FFA0、子の無い文書の toString は "<>"。
import { XML_STATUS, escapeXML, parseLegacyXML } from '../player/legacyxml.js';
import { ASArray, ASObject, publicKey } from './object.js';

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: 'ﾠ' };
// 解析の誤り → 例外の番号（XML parser failure: …）。
const ERRORS = { [XML_STATUS.element]: 1090, [XML_STATUS.cdata]: 1091, [XML_STATUS.comment]: 1094, [XML_STATUS.unclosed]: 1096, [XML_STATUS.unopened]: 1096 };

/** @param {import('./vm.js').AVM2} vm */
export function installXMLDocument(vm) {
  const c = vm.classes;
  const str = (v) => vm.toStr(v);
  // ノードの中身は self.xn: { type, name, value, attributes（ASObject）, children（ノードの ASObject）, parent }。
  const N = (self) => self.xn;
  const init = (self, type, value) => {
    self.xn = { type, name: type === 1 ? value : null, value: type === 1 ? null : value, attributes: new ASObject(c.Object), children: [], parent: null };
    return self;
  };
  const detach = (node) => {
    const parent = N(node).parent;
    if (parent) N(parent).children.splice(N(parent).children.indexOf(node), 1);
    N(node).parent = null;
  };
  const insert = (parent, node, at) => {
    detach(node);
    N(parent).children.splice(Math.min(at, N(parent).children.length), 0, node);
    N(node).parent = parent;
  };
  const attrList = (n) => [...vm.enumerate(n.attributes)].map((k) => [String(k), n.attributes.values.get(publicKey(String(k)))]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const serialize = (node) => {
    const n = N(node);
    if (n.type !== 1) return escapeXML(n.value ?? '');
    const inner = n.children.map(serialize).join('');
    if (n.name === null && node.klass?.isSubclassOf?.(c.XMLDocument)) return n.children.length ? `${n.xmlDecl ?? ''}${n.docTypeDecl ?? ''}${inner}` : '<>';
    const attrs = attrList(n).map(([k, v]) => ` ${k}="${escapeXML(str(v))}"`).join('');
    return inner === '' && n.children.length === 0 ? `<${n.name ?? ''}${attrs} />` : `<${n.name ?? ''}${attrs}>${inner}</${n.name ?? ''}>`;
  };
  const sibling = (self, step) => {
    const parent = N(self).parent;
    const list = parent ? N(parent).children : null;
    return list?.[list.indexOf(self) + step] ?? null;
  };
  const newNode = (type, value) => init(new ASObject(c.XMLNode), type, value);
  const clone = (node, deep) => {
    const n = N(node), copy = newNode(n.type, n.type === 1 ? n.name : n.value);
    for (const [k, v] of attrList(n)) N(copy).attributes.values.set(publicKey(k), v);
    if (deep) for (const child of n.children) insert(copy, clone(child, true), Infinity);
    return copy;
  };
  // 名前空間: 名前の "接頭辞:" と、自分か先祖の xmlns:接頭辞（接頭辞が無ければ xmlns）属性。
  const split = (name) => { const at = (name ?? '').indexOf(':'); return at < 0 ? ['', name ?? ''] : [name.slice(0, at), name.slice(at + 1)]; };
  const lookupNamespace = (self, prefix) => {
    for (let node = self; node; node = N(node).parent) {
      const v = N(node).attributes.values.get(publicKey(prefix ? `xmlns:${prefix}` : 'xmlns'));
      if (v !== undefined) return str(v);
    }
    return null;
  };
  const lookupPrefix = (self, uri) => {
    for (let node = self; node; node = N(node).parent) {
      for (const [k, v] of attrList(N(node))) if (str(v) === uri && (k === 'xmlns' || k.startsWith('xmlns:'))) return k === 'xmlns' ? '' : k.slice(6);
    }
    return null;
  };

  c.XMLNode = vm.defineClass({
    name: 'flash.xml::XMLNode',
    allocate: (klass) => init(new ASObject(klass), 1, null),
    construct: (self, [type, value]) => init(self, vm.toInt32(type) === 1 ? 1 : 3, value === null || value === undefined ? null : str(value)),
    getters: {
      nodeType: (self) => N(self).type,
      nodeName: (self) => N(self).name,
      nodeValue: (self) => N(self).value,
      attributes: (self) => N(self).attributes,
      childNodes: (self) => new ASArray(vm, N(self).children.slice()),
      firstChild: (self) => N(self).children[0] ?? null,
      lastChild: (self) => N(self).children[N(self).children.length - 1] ?? null,
      parentNode: (self) => N(self).parent,
      nextSibling: (self) => sibling(self, 1),
      previousSibling: (self) => sibling(self, -1),
      localName: (self) => (N(self).type === 1 ? split(N(self).name)[1] : null),
      prefix: (self) => (N(self).type === 1 ? split(N(self).name)[0] : null),
      namespaceURI: (self) => (N(self).type === 1 ? lookupNamespace(self, split(N(self).name)[0]) : null),
    },
    setters: {
      nodeName: (self, v) => { N(self).name = v === null || v === undefined ? null : str(v); },
      nodeValue: (self, v) => { N(self).value = v === null || v === undefined ? null : str(v); },
      attributes: (self, v) => { if (v instanceof ASObject) N(self).attributes = v; },
    },
    methods: {
      hasChildNodes: (self) => N(self).children.length > 0,
      // すでに自分の子になっているノードは動かさない（実機で確認）。
      appendChild: (self, [node]) => { if (node instanceof ASObject && node.xn && node !== self && N(node).parent !== self) insert(self, node, Infinity); },
      insertBefore: (self, [node, before]) => {
        if (!(node instanceof ASObject) || !node.xn || node === self) return;
        const at = N(self).children.indexOf(before);
        if (at >= 0) insert(self, node, at);
      },
      removeNode: (self) => detach(self),
      cloneNode: (self, [deep]) => clone(self, vm.toBoolean(deep)),
      toString: (self) => serialize(self),
      getNamespaceForPrefix: (self, [prefix]) => lookupNamespace(self, str(prefix)),
      getPrefixForNamespace: (self, [uri]) => lookupPrefix(self, str(uri)),
    },
  });

  const parse = (self, text) => {
    const n = N(self);
    for (const child of n.children) N(child).parent = null;
    n.children = [];
    const result = parseLegacyXML(text, { ignoreWhite: n.ignoreWhite === true, trimLeading: true, entities: ENTITIES });
    n.xmlDecl = result.xmlDecl;
    n.docTypeDecl = result.docTypeDecl;
    const build = (plain, parent) => {
      const node = newNode(plain.type, plain.type === 1 ? plain.name : plain.value);
      for (const [k, v] of plain.attrs) N(node).attributes.values.set(publicKey(k), v);
      insert(parent, node, Infinity);
      for (const child of plain.children) build(child, node);
    };
    for (const child of result.children) build(child, self);
    if (result.status !== XML_STATUS.ok) vm.throwError('TypeError', ERRORS[result.status] ?? 1090, 'XML parser failure.');
  };
  c.XMLDocument = vm.defineClass({
    name: 'flash.xml::XMLDocument', base: c.XMLNode,
    allocate: (klass) => init(new ASObject(klass), 1, null),
    construct: (self, [source]) => { if (source !== null && source !== undefined) parse(self, str(source)); },
    getters: {
      ignoreWhite: (self) => N(self).ignoreWhite === true,
      xmlDecl: (self) => N(self).xmlDecl ?? null,
      docTypeDecl: (self) => N(self).docTypeDecl ?? null,
      // id 属性を持つ要素の表（id → 要素）。
      idMap: (self) => {
        const map = new ASObject(c.Object);
        const walk = (node) => {
          const id = N(node).attributes.values.get(publicKey('id'));
          if (N(node).type === 1 && id !== undefined) map.values.set(publicKey(str(id)), node);
          for (const child of N(node).children) walk(child);
        };
        for (const child of N(self).children) walk(child);
        return map;
      },
    },
    setters: {
      ignoreWhite: (self, v) => { N(self).ignoreWhite = vm.toBoolean(v); },
      xmlDecl: (self, v) => { N(self).xmlDecl = v === null || v === undefined ? undefined : str(v); },
      docTypeDecl: (self, v) => { N(self).docTypeDecl = v === null || v === undefined ? undefined : str(v); },
    },
    methods: {
      parseXML: (self, [text]) => parse(self, str(text)),
      createElement: (_, [name]) => newNode(1, str(name)),
      createTextNode: (_, [text]) => newNode(3, str(text)),
      toString: (self) => serialize(self),
    },
  });
  vm.defineClass({ name: 'flash.xml::XMLNodeType', final: true, staticValues: { ELEMENT_NODE: 1, TEXT_NODE: 3 } });
}
