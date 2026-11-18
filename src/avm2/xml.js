// XML と XMLList（E4X）。
//
// 文書は、ここで解析して自前の木（node）として持つ。node は { kind, name: { uri, local } | null, value, attributes, children, parent, spaces }。
// kind は 'element' / 'text' / 'attribute' / 'comment' / 'instruction'。spaces は、その要素で宣言された名前空間 [{ prefix, uri }]。
// スクリプトから見える XML オブジェクトは node ごとに 1 つ（同じ node は同じオブジェクト）、XMLList は node の並び。
// 名前での参照（x.item、x.@id、x..item）や代入・削除は、vm.js と interp.js から vm.xml の関数を通して行う。
// 解析には深さの上限を設け、node の数だけ割り当ての上限から引く。
import { ASArray, ASObject, publicKey } from './object.js';

const MAX_DEPTH = 200; // 要素の入れ子の上限
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: '\u00a0' };
const text = (s) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
const quoted = (s) => s.replace(/[&<"\n\r\t]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '"': '&quot;', '\n': '&#xA;', '\r': '&#xD;', '\t': '&#x9;' })[ch]);

export function installXML(vm) {
  const c = vm.classes;
  const str = (v) => vm.toStr(v);
  const settings = { ignoreComments: true, ignoreProcessingInstructions: true, ignoreWhitespace: true, prettyPrinting: true, prettyIndent: 2 };
  const fail = (id, message) => vm.throwError('TypeError', id, message);

  // --- node ---
  const node = (kind, name, value = '') => { vm.charge(1); return { kind, name, value, attributes: [], children: [], parent: null, spaces: [], as: null }; };
  const isXML = (v) => v instanceof ASObject && !!v.xml;
  const isList = (v) => v instanceof ASObject && !!v.list;
  /** node に対応する XML オブジェクト（node ごとに 1 つ）。 */
  const wrap = (n) => (n.as ??= Object.assign(new ASObject(c.XML), { xml: n }));
  /** XMLList。target と name は、代入で要素を足すときの足し先（x.item と書いたときの x（XML か XMLList）と item）。 */
  const list = (nodes, target = null, name = null) => Object.assign(new ASObject(c.XMLList), { list: { nodes, target, name } });
  const nodesOf = (v) => (isXML(v) ? [v.xml] : isList(v) ? v.list.nodes : []);
  const copy = (n, depth = 0) => {
    if (depth > MAX_DEPTH) fail(1023, 'Stack overflow occurred.');
    const out = Object.assign(node(n.kind, n.name && { ...n.name }, n.value), { cdata: n.cdata });
    out.spaces = n.spaces.map((s) => ({ ...s }));
    out.attributes = n.attributes.map((a) => Object.assign(copy(a, depth + 1), { parent: out }));
    out.children = n.children.map((child) => Object.assign(copy(child, depth + 1), { parent: out }));
    return out;
  };
  const detach = (n) => {
    if (!n.parent) return;
    const from = n.kind === 'attribute' ? n.parent.attributes : n.parent.children;
    const at = from.indexOf(n);
    if (at >= 0) from.splice(at, 1);
    n.parent = null;
  };
  // 値を、parent の子にできる node の並びにする。XML は、よそに親があれば写しを使う。それ以外は文字列の node。
  const asChildren = (value) => {
    if (isXML(value) || isList(value)) return nodesOf(value).map((n) => (n.kind === 'attribute' ? node('text', null, n.value) : n.parent ? copy(n) : n));
    return [node('text', null, value === undefined || value === null ? '' : str(value))];
  };
  const insert = (parent, at, nodes) => {
    for (let p = parent; p; p = p.parent) if (nodes.includes(p)) fail(1118, 'Illegal cyclical loop between nodes.');
    for (const n of nodes) { detach(n); n.parent = parent; }
    parent.children.splice(at, 0, ...nodes);
  };

  // --- 解析 ---
  const decode = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (all, name) => {
    if (name[0] !== '#') return ENTITIES[name] ?? all;
    const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
  /** 文字列を解析して、最上位の node の並びを返す。 */
  const parse = (source) => {
    vm.step(source.length >> 2);
    let pos = 0;
    const roots = [];
    const open = []; // 開いている要素。それぞれ、接頭辞から名前空間を引くための宣言を持つ
    const lookup = (prefix, forAttribute) => {
      if (prefix === '' && forAttribute) return ''; // 接頭辞の無い属性は、名前空間に属さない
      for (let i = open.length - 1; i >= 0; i--) {
        const found = open[i].spaces.find((s) => s.prefix === prefix);
        if (found) return found.uri;
      }
      return prefix === 'xml' ? 'http://www.w3.org/XML/1998/namespace' : '';
    };
    const add = (n) => {
      const parent = open[open.length - 1];
      if (parent) { n.parent = parent; parent.children.push(n); } else roots.push(n);
    };
    const addText = (raw, verbatim) => {
      const value = verbatim ? raw : decode(raw);
      const shown = settings.ignoreWhitespace && !verbatim ? value.trim() : value;
      if (shown !== '' || (verbatim && raw !== '')) add(Object.assign(node('text', null, shown), { cdata: verbatim })); // CDATA は、文字列にするときも CDATA のまま
    };
    while (pos < source.length) {
      const lt = source.indexOf('<', pos);
      if (lt < 0) { addText(source.slice(pos), false); break; }
      if (lt > pos) addText(source.slice(pos, lt), false);
      pos = lt;
      if (source.startsWith('<!--', pos)) {
        const end = source.indexOf('-->', pos + 4);
        if (end < 0) fail(1094, 'XML parser failure: Unterminated comment.');
        if (!settings.ignoreComments) add(node('comment', null, source.slice(pos + 4, end)));
        pos = end + 3;
      } else if (source.startsWith('<![CDATA[', pos)) {
        const end = source.indexOf(']]>', pos + 9);
        if (end < 0) fail(1091, 'XML parser failure: Unterminated CDATA section.');
        addText(source.slice(pos + 9, end), true);
        pos = end + 3;
      } else if (source.startsWith('<?', pos)) {
        const end = source.indexOf('?>', pos + 2);
        if (end < 0) fail(1097, 'XML parser failure: Unterminated processing instruction.');
        const m = /^(\S+)\s*([\s\S]*)$/.exec(source.slice(pos + 2, end));
        if (m && m[1].toLowerCase() !== 'xml' && !settings.ignoreProcessingInstructions) add(node('instruction', { uri: '', local: m[1] }, m[2]));
        pos = end + 2;
      } else if (source.startsWith('<!', pos)) {
        const end = source.indexOf('>', pos + 2); // DOCTYPE は読み飛ばす
        if (end < 0) fail(1093, 'XML parser failure: Unterminated DOCTYPE declaration.');
        pos = end + 1;
      } else if (source[pos + 1] === '/') {
        const end = source.indexOf('>', pos + 2);
        const name = end < 0 ? '' : source.slice(pos + 2, end).trim();
        const top = open.pop();
        if (!top) fail(1088, 'The markup in the document following the root element must be well-formed.');
        if (top.tag !== name) fail(1085, `The element type "${top?.tag ?? name}" must be terminated by the matching end-tag "</${top?.tag ?? name}>".`);
        pos = end + 1;
      } else {
        const m = /^<([^\s/>=<]+)/.exec(source.slice(pos, pos + 256));
        if (!m) fail(1090, 'XML parser failure: element is malformed.');
        pos += m[0].length;
        const element = node('element', null);
        element.tag = m[1];
        const attributes = [];
        let closed = false;
        for (;;) {
          while (/\s/.test(source[pos] ?? '')) pos++;
          if (source.startsWith('/>', pos)) { pos += 2; closed = true; break; }
          if (source[pos] === '>') { pos++; break; }
          const a = /^([^\s/>=<]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(source.slice(pos));
          if (!a) fail(pos >= source.length ? 1090 : 1090, 'XML parser failure: element is malformed.');
          pos += a[0].length;
          if ((a[2] ?? a[3]).includes('<')) fail(1095, 'XML parser failure: Unterminated attribute.');
          const value = decode(a[2] ?? a[3]);
          if (a[1] === 'xmlns') element.spaces.push({ prefix: '', uri: value });
          else if (a[1].startsWith('xmlns:')) element.spaces.push({ prefix: a[1].slice(6), uri: value });
          else {
            if (attributes.some(([name]) => name === a[1])) fail(1104, `Attribute "${a[1]}" was already specified for element "${m[1]}".`);
            attributes.push([a[1], value]);
          }
        }
        if (open.length >= MAX_DEPTH) fail(1023, 'Stack overflow occurred.');
        add(element);
        open.push(element);
        const split = (qualified) => { const at = qualified.indexOf(':'); return at < 0 ? ['', qualified] : [qualified.slice(0, at), qualified.slice(at + 1)]; };
        const [prefix, local] = split(m[1]);
        element.name = { uri: lookup(prefix, false), local };
        for (const [qualified, value] of attributes) {
          const [p, l] = split(qualified);
          const attribute = node('attribute', { uri: lookup(p, true), local: l }, value);
          attribute.parent = element;
          element.attributes.push(attribute);
        }
        if (closed) open.pop();
      }
    }
    if (open.length) fail(1085, `The element type "${open[open.length - 1].tag}" must be terminated by the matching end-tag "</${open[open.length - 1].tag}>".`);
    return roots;
  };

  // --- 文字列化 ---
  const prefixFor = (n, uri) => {
    for (let p = n; p; p = p.parent) {
      const found = p.spaces.find((s) => s.uri === uri);
      if (found) return found.prefix;
    }
    return undefined;
  };
  const qualified = (n, owner) => {
    if (!n.name.uri) return n.name.local;
    const prefix = prefixFor(owner, n.name.uri);
    return prefix ? `${prefix}:${n.name.local}` : n.name.local;
  };
  const simple = (n) => n.kind === 'text' || n.kind === 'attribute' || (n.kind === 'element' && !n.children.some((child) => child.kind === 'element'));
  const content = (n) => (n.kind === 'element' ? n.children.filter((child) => child.kind === 'text' || child.kind === 'element').map(content).join('') : n.kind === 'text' || n.kind === 'attribute' ? n.value : '');
  /** node を XML の文字列にする。indent は字下げ（整形しないなら null）。 */
  const serialize = (n, indent, depth = 0) => {
    vm.step(1);
    if (depth > MAX_DEPTH) fail(1023, 'Stack overflow occurred.');
    const pad = indent === null ? '' : ' '.repeat(indent);
    if (n.kind === 'text') return pad + (n.cdata ? `<![CDATA[${n.value}]]>` : text(indent === null ? n.value : n.value.trim()));
    if (n.kind === 'attribute') return pad + quoted(n.value);
    if (n.kind === 'comment') return `${pad}<!--${n.value}-->`;
    if (n.kind === 'instruction') return `${pad}<?${n.name.local} ${n.value}?>`;
    let tag = qualified(n, n);
    // 名前空間の宣言: この要素で宣言されたものと、親が無いときに限り、名前に使われているが宣言の無いもの。
    const declared = n.spaces.map((s) => ` xmlns${s.prefix ? `:${s.prefix}` : ''}="${quoted(s.uri)}"`);
    if (n.name.uri && prefixFor(n, n.name.uri) === undefined) declared.push(` xmlns="${quoted(n.name.uri)}"`);
    tag += n.attributes.map((a) => ` ${qualified(a, n)}="${quoted(a.value)}"`).join('') + declared.join('');
    if (!n.children.length) return `${pad}<${tag}/>`;
    const name = qualified(n, n);
    // 子が文字列 1 つだけなら 1 行に書く。それ以外は、子を 1 行ずつ字下げして並べる。
    if (indent === null || (n.children.length === 1 && n.children[0].kind === 'text')) {
      return `${pad}<${tag}>${n.children.map((child) => serialize(child, null, depth + 1)).join('')}</${name}>`;
    }
    return `${pad}<${tag}>\n${n.children.map((child) => serialize(child, indent + settings.prettyIndent, depth + 1)).join('\n')}\n${pad}</${name}>`;
  };
  const xmlString = (n) => serialize(n, settings.prettyPrinting ? 0 : null);
  const nodeString = (n) => (simple(n) ? content(n) : xmlString(n));
  const listString = (nodes) => (nodes.every((n) => n.kind === 'text' || n.kind === 'attribute') || (nodes.length === 1 && simple(nodes[0])) ? nodes.map(content).join('') : nodes.map(xmlString).join('\n'));

  // --- 名前での参照 ---
  // 実行時の名前 rn から、探す名前 { local, uris, attribute, index } を作る。
  const wanted = (rn) => {
    if (rn.raw !== undefined) rn = vm.keyName(str(rn.raw));
    let local = typeof rn.name === 'number' ? String(rn.name) : rn.name || '*'; // 名前の無い参照（x.* や x.@*）は「全部」
    let attribute = !!rn.attribute;
    if (!attribute && typeof local === 'string' && local[0] === '@') { attribute = true; local = local.slice(1); } // x["@id"]
    const uris = rn.keys.filter((key) => key.startsWith('p:')).map((key) => key.slice(2, key.indexOf('|')));
    return { local, uris, attribute, index: !attribute && /^\d+$/.test(local) ? Number(local) : -1 };
  };
  const matches = (n, want) => want.local === '*' || (n.name.local === want.local && (want.uris.includes(n.name.uri) || want.uris.length === 0));
  const select = (n, want) => {
    if (n.kind !== 'element') return [];
    return want.attribute ? n.attributes.filter((a) => matches(a, want)) : n.children.filter((child) => (want.local === '*' ? true : child.kind === 'element' && matches(child, want)));
  };
  const descend = (n, want, out, depth = 0) => {
    if (n.kind !== 'element' || depth > MAX_DEPTH) return;
    vm.step(1);
    if (want.attribute) out.push(...n.attributes.filter((a) => matches(a, want)));
    for (const child of n.children) {
      if (!want.attribute && (want.local === '*' || (child.kind === 'element' && matches(child, want)))) out.push(child);
      descend(child, want, out, depth + 1);
    }
  };
  const nameOf = (want) => ({ uri: want.uris[0] ?? '', local: want.local });
  // 空の XMLList（x.a.b の a が無いときの x.a など）への代入のために、足し先をたどって要素を作る。
  // 作れたら（または、もともと要素があれば）そのリストを、作れなければ null を返す。
  const resolve = (obj, depth = 0) => {
    const l = obj.list;
    if (l.nodes.length) return obj;
    if (!l.target || !l.name || l.name.attribute || l.name.local === '*' || depth > MAX_DEPTH) return null;
    const base = isXML(l.target) ? l.target : resolve(l.target, depth + 1);
    const nodes = base ? nodesOf(base) : [];
    if (nodes.length !== 1 || nodes[0].kind !== 'element') return null;
    let found = select(nodes[0], l.name);
    if (!found.length) {
      found = [node('element', nameOf(l.name))];
      insert(nodes[0], nodes[0].children.length, found);
    }
    l.nodes = found;
    return obj;
  };

  vm.xml = {
    get(obj, rn) {
      const want = wanted(rn);
      if (isList(obj)) {
        if (want.index >= 0) { const n = obj.list.nodes[want.index]; return n ? wrap(n) : undefined; }
        return list(obj.list.nodes.flatMap((n) => select(n, want)), obj, want);
      }
      if (want.index >= 0) return want.index === 0 ? obj : undefined;
      return list(select(obj.xml, want), obj, want);
    },
    set(obj, rn, value) {
      const want = wanted(rn);
      if (isList(obj)) {
        const { nodes, target, name } = obj.list;
        if (want.index >= 0) {
          // 範囲内なら、その要素を置き換える。範囲外なら、末尾に足す（足し先の要素があれば、その子としても足す）。
          const old = nodes[want.index];
          if (old) {
            if (old.kind === 'attribute' || old.kind === 'text') { old.value = isXML(value) || isList(value) ? listString(nodesOf(value)) : str(value); return; }
            if (!isXML(value) && !isList(value)) { old.children = []; insert(old, 0, asChildren(value)); return; }
            const fresh = asChildren(value);
            if (old.parent) insert(old.parent, old.parent.children.indexOf(old), fresh);
            detach(old);
            nodes.splice(want.index, 1, ...fresh);
            return;
          }
          const base = target && name && !name.attribute ? (isXML(target) ? target : resolve(target)) : null;
          const parents = base ? nodesOf(base) : [];
          if (parents.length === 1 && parents[0].kind === 'element') {
            const fresh = isXML(value) || isList(value) ? asChildren(value) : [node('element', nameOf(name))];
            if (!isXML(value) && !isList(value)) insert(fresh[0], 0, asChildren(value));
            // 同じ名前の最後の要素の直後に入れる（無ければ末尾）。
            const last = nodes[nodes.length - 1];
            insert(parents[0], last?.parent === parents[0] ? parents[0].children.indexOf(last) + 1 : parents[0].children.length, fresh);
            nodes.push(...fresh);
          } else nodes.push(...nodesOf(value)); // 足し先の無いリスト（絞り込みの結果を作るときなど）には、そのまま足す
          return;
        }
        if (!nodes.length && !resolve(obj)) return;
        if (obj.list.nodes.length !== 1) fail(1089, 'Assignment to lists with more than one item is not supported.');
        vm.xml.set(wrap(obj.list.nodes[0]), rn, value);
        return;
      }
      const n = obj.xml;
      if (n.kind !== 'element' || want.index >= 0) return;
      if (want.attribute) {
        const shown = isXML(value) || isList(value) ? listString(nodesOf(value)) : str(value);
        const old = n.attributes.find((a) => matches(a, want));
        if (old) old.value = shown;
        else n.attributes.push(Object.assign(node('attribute', nameOf(want), shown), { parent: n }));
        return;
      }
      // 同じ名前の子があれば、最初の 1 つを置き換えて残りを消す。無ければ末尾に足す。
      const olds = select(n, want);
      let at = olds.length ? n.children.indexOf(olds[0]) : n.children.length;
      let fresh;
      if (isXML(value) || isList(value)) fresh = asChildren(value);
      else {
        fresh = [node('element', olds[0]?.name ? { ...olds[0].name } : nameOf(want))];
        insert(fresh[0], 0, asChildren(value));
      }
      for (const old of olds) detach(old);
      at = Math.min(at, n.children.length);
      insert(n, at, fresh);
    },
    has(obj, rn) {
      const want = wanted(rn);
      if (want.index >= 0) return isList(obj) ? want.index < obj.list.nodes.length : want.index === 0;
      return nodesOf(obj).some((n) => select(n, want).length > 0);
    },
    delete(obj, rn) {
      const want = wanted(rn);
      if (isList(obj) && want.index >= 0) {
        const n = obj.list.nodes[want.index];
        if (n) { detach(n); obj.list.nodes.splice(want.index, 1); }
        return true;
      }
      for (const n of nodesOf(obj)) for (const found of select(n, want)) detach(found);
      return true;
    },
    descendants(obj, rn) {
      const out = [];
      for (const n of nodesOf(obj)) descend(n, wanted(rn), out);
      return list(out);
    },
    enumerate: (obj) => (isList(obj) ? obj.list.nodes.map((_, i) => i) : [0]),
    // == 演算子（どちらかが XML / XMLList のとき）。XML どうしは中身で比べる。空の XMLList は undefined と等しい。
    // 基本型とは、中身が文字だけの XML（か、それ 1 つだけの XMLList）なら文字列として比べ、それ以外は等しくない。
    equals(a, b) {
      if (!vm.xml.is(a) || !vm.xml.is(b)) {
        const [value, plain] = vm.xml.is(a) ? [a, b] : [b, a];
        const nodes = nodesOf(value);
        if (plain === undefined || plain === null) return isList(value) && nodes.length === 0 && plain === undefined;
        if (plain instanceof ASObject) return false;
        return nodes.length === 1 && simple(nodes[0]) && content(nodes[0]) === str(plain);
      }
      const x = nodesOf(a), y = nodesOf(b);
      if (x.length !== y.length) return false;
      return x.every((n, i) => (simple(n) && simple(y[i]) && (n.kind !== 'element' || y[i].kind !== 'element') ? content(n) === content(y[i]) : serialize(n, null) === serialize(y[i], null)));
    },
    concat: (a, b) => list([...nodesOf(a), ...nodesOf(b)]),
    is: (v) => isXML(v) || isList(v),
    string: (v) => (isXML(v) ? nodeString(v.xml) : listString(v.list.nodes)),
    // esc_xelem / esc_xattr: XML リテラルの { } の中の値を、要素の中身・属性値として埋め込める文字列にする。
    escapeElement: (v) => (isXML(v) || isList(v) ? nodesOf(v).map(xmlString).join('\n') : text(str(v))),
    escapeAttribute: (v) => quoted(str(v)),
  };

  // --- クラス ---
  const qname = (name) => { const q = new ASObject(c.QName); q.qname = { name: name.local, ns: { kind: 'package', uri: name.uri } }; return q; };
  // 引数（名前）を、探す名前にする。省略や "*" は全部。
  const named = (v, attribute = false) => {
    if (v instanceof ASObject && v.qname) return { local: v.qname.name, uris: [v.qname.ns.uri], attribute, index: -1 };
    const s = v === undefined ? '*' : str(v);
    return s[0] === '@' ? { local: s.slice(1), uris: [''], attribute: true, index: -1 } : { local: s, uris: [''], attribute, index: -1 };
  };
  // 文字列（か、ほかの値）を node の並びにする。
  const fromValue = (v) => {
    if (isXML(v) || isList(v)) return nodesOf(v);
    if (v === null || v === undefined) return [];
    return parse(str(v));
  };
  const each = (self, fn) => nodesOf(self).map(fn);
  const flat = (self, fn) => list(nodesOf(self).flatMap(fn));
  const one = (self) => {
    if (isXML(self)) return self.xml;
    if (self.list.nodes.length !== 1) fail(1086, 'The method only works on lists containing one item.');
    return self.list.nodes[0];
  };
  // XML と XMLList に共通のメソッド。XMLList では、要素が 1 つのときだけ使えるものがある（one）。
  const methods = {
    toString: (self) => vm.xml.string(self),
    toXMLString: (self) => each(self, xmlString).join('\n'),
    valueOf: (self) => self,
    length: (self) => (isXML(self) ? 1 : self.list.nodes.length),
    child: (self, [name]) => (typeof name === 'number' ? flat(self, (n) => n.children.slice(name, name + 1)) : flat(self, (n) => select(n, named(name)))),
    children: (self) => flat(self, (n) => n.children.slice()),
    elements: (self, [name]) => flat(self, (n) => n.children.filter((child) => child.kind === 'element' && matches(child, named(name)))),
    attribute: (self, [name]) => flat(self, (n) => select(n, named(name, true))),
    attributes: (self) => flat(self, (n) => n.attributes.slice()),
    descendants: (self, [name]) => { const out = []; for (const n of nodesOf(self)) descend(n, named(name), out); return list(out); },
    text: (self) => flat(self, (n) => n.children.filter((child) => child.kind === 'text')),
    comments: (self) => flat(self, (n) => n.children.filter((child) => child.kind === 'comment')),
    processingInstructions: (self) => flat(self, (n) => n.children.filter((child) => child.kind === 'instruction')),
    parent: (self) => { const parents = [...new Set(each(self, (n) => n.parent))]; return parents.length === 1 && parents[0] ? wrap(parents[0]) : undefined; },
    copy: (self) => (isXML(self) ? wrap(copy(self.xml)) : list(each(self, (n) => copy(n)))),
    contains: (self, [v]) => nodesOf(self).some((n) => vm.xml.equals(wrap(n), v)),
    hasSimpleContent: (self) => (isXML(self) ? simple(self.xml) : self.list.nodes.every((n) => n.kind !== 'element') || (self.list.nodes.length === 1 && simple(self.list.nodes[0]))),
    hasComplexContent: (self) => !methods.hasSimpleContent(self),
    hasOwnProperty: (self, [name]) => { const want = named(name); return nodesOf(self).some((n) => select(n, want).length > 0); },
    propertyIsEnumerable: (self, [name]) => /^\d+$/.test(str(name)) && Number(str(name)) < (isXML(self) ? 1 : self.list.nodes.length),
    normalize: (self) => self,
    // ここから下は、XML（か、要素が 1 つの XMLList）だけ。
    name: (self) => { const n = one(self); return n.name ? qname(n.name) : null; },
    localName: (self) => one(self).name?.local ?? null,
    nodeKind: (self) => { const kind = one(self).kind; return kind === 'instruction' ? 'processing-instruction' : kind; },
    childIndex: (self) => { const n = one(self); return n.parent && n.kind !== 'attribute' ? n.parent.children.indexOf(n) : -1; },
    namespace: (self, [prefix]) => {
      const n = one(self);
      if (prefix !== undefined) {
        for (let p = n; p; p = p.parent) { const found = p.spaces.find((s) => s.prefix === str(prefix)); if (found) return vm.newNamespace({ kind: 'namespace', uri: found.uri, prefix: found.prefix }); }
        return undefined;
      }
      return vm.newNamespace({ kind: 'namespace', uri: n.name?.uri ?? '', prefix: prefixFor(n, n.name?.uri ?? '') });
    },
    namespaceDeclarations: (self) => new ASArray(vm, one(self).spaces.map((s) => vm.newNamespace({ kind: 'namespace', uri: s.uri, prefix: s.prefix }))),
    inScopeNamespaces: (self) => { const out = []; for (let p = one(self); p; p = p.parent) for (const s of p.spaces) if (!out.some((o) => o.prefix === s.prefix)) out.push(s); return new ASArray(vm, out.map((s) => vm.newNamespace({ kind: 'namespace', uri: s.uri, prefix: s.prefix }))); },
    addNamespace: (self, [ns]) => { const n = one(self); if (ns instanceof ASObject && ns.namespace) n.spaces.push({ prefix: ns.namespace.prefix ?? '', uri: ns.namespace.uri }); return self; },
    setName: (self, [name]) => { const n = one(self); if (n.name) n.name = name instanceof ASObject && name.qname ? { uri: name.qname.ns.uri, local: name.qname.name } : { uri: n.name.uri, local: str(name) }; },
    setLocalName: (self, [name]) => { const n = one(self); if (n.name) n.name.local = name instanceof ASObject && name.qname ? name.qname.name : str(name); },
    setNamespace: (self, [ns]) => { const n = one(self); if (n.name && ns instanceof ASObject && ns.namespace) n.name.uri = ns.namespace.uri; },
    // 文字列などを足すとき、最後の子が要素なら、それと同じ名前の要素に包まれる（実機で確認）。
    appendChild: (self, [child]) => {
      const n = one(self);
      if (n.kind !== 'element') return self;
      const last = n.children[n.children.length - 1];
      let fresh = asChildren(child);
      if (!isXML(child) && !isList(child) && last?.kind === 'element') {
        const wrapper = node('element', { ...last.name });
        insert(wrapper, 0, fresh);
        fresh = [wrapper];
      }
      insert(n, n.children.length, fresh);
      return self;
    },
    prependChild: (self, [child]) => { const n = one(self); if (n.kind === 'element') insert(n, 0, asChildren(child)); return self; },
    // 基準の子 at の前後に入れる。at が null なら、前に入れるときは末尾、後に入れるときは先頭。基準が子でなければ undefined。
    insertChildBefore: (self, [at, child]) => {
      const n = one(self);
      const index = at === null ? n.children.length : nodesOf(at).length === 1 ? n.children.indexOf(nodesOf(at)[0]) : -1;
      if (index < 0) return undefined;
      insert(n, index, asChildren(child));
      return self;
    },
    insertChildAfter: (self, [at, child]) => {
      const n = one(self);
      const index = at === null ? 0 : nodesOf(at).length === 1 ? n.children.indexOf(nodesOf(at)[0]) + 1 : 0;
      if (at !== null && index === 0) return undefined;
      insert(n, index, asChildren(child));
      return self;
    },
    setChildren: (self, [value]) => { const n = one(self); for (const child of n.children.slice()) detach(child); insert(n, 0, asChildren(value)); return self; },
    replace: (self, [name, value]) => { vm.xml.set(wrap(one(self)), vm.keyName(typeof name === 'number' ? name : str(name)), value); return self; },
  };
  const statics = (klass) => {
    for (const key of Object.keys(settings)) {
      klass.staticTraits.set(publicKey(key), {
        kind: 'accessor', key: publicKey(key), name: key, get: vm.native(() => settings[key]),
        set: vm.native((_, [v]) => { settings[key] = typeof settings[key] === 'number' ? Math.max(0, Math.min(vm.toInt32(v), 100)) : vm.toBoolean(v); }),
      });
    }
  };
  // XML(値): XML はそのまま。XMLList は要素が 1 つならそれ。文字列は解析する（最上位の要素は 1 つだけ）。
  const toXML = (v) => {
    if (isXML(v)) return v;
    if (isList(v)) { if (v.list.nodes.length !== 1) fail(1088, 'The markup in the document following the root element must be well-formed.'); return wrap(v.list.nodes[0]); }
    if (v === null || v === undefined) return fail(v === null ? 1009 : 1010, 'Cannot access a property or method of a null object reference.');
    const roots = parse(str(v));
    if (roots.length > 1) fail(1088, 'The markup in the document following the root element must be well-formed.');
    return wrap(roots[0] ?? node('text', null, ''));
  };
  c.XML = vm.defineClass({
    name: 'XML', final: true, dynamic: true,
    allocate: (klass, [v]) => (v === undefined || v === null ? wrap(node('text', null, '')) : isXML(v) ? wrap(copy(v.xml)) : toXML(v)),
    construct: () => {},
    callAsFunction: ([v]) => (v === undefined ? wrap(node('text', null, '')) : toXML(v)),
    methods,
  });
  c.XMLList = vm.defineClass({
    name: 'XMLList', final: true, dynamic: true,
    allocate: (klass, [v]) => list(fromValue(v).slice()),
    construct: () => {},
    callAsFunction: ([v]) => (isList(v) ? v : list(fromValue(v).slice())),
    methods,
  });
  statics(c.XML);
  c.QName = vm.defineClass({
    name: 'QName', final: true,
    allocate: (klass) => Object.assign(new ASObject(klass), { qname: { name: '', ns: { kind: 'package', uri: '' } } }),
    // new QName(名前) / new QName(名前空間, 名前)
    construct: (self, args) => {
      const [space, name] = args.length >= 2 ? args : [undefined, args[0]];
      if (name instanceof ASObject && name.qname) self.qname = { name: name.qname.name, ns: { ...name.qname.ns } };
      else self.qname.name = name === undefined ? '' : str(name);
      if (space instanceof ASObject && space.namespace) self.qname.ns = { kind: 'package', uri: space.namespace.uri };
      else if (space !== undefined && space !== null) self.qname.ns = { kind: 'package', uri: str(space) };
    },
    getters: { localName: (self) => self.qname.name, uri: (self) => self.qname.ns.uri },
    methods: { toString: (self) => (self.qname.ns.uri ? `${self.qname.ns.uri}::${self.qname.name}` : self.qname.name), valueOf: (self) => self },
  });
}
