// 古い形の XML（AS1 / AS2 の XML、AS3 の flash.xml.XMLDocument）の解析。VM に依存しない。
// 結果のノードは { type, name, value, attrs, children }（type は 1 が要素、3 が文字列。attrs は [名前, 値] を書かれた順に並べたもの）。
// 規則は、実機の AS2 の XML（test/as/xml.as）と AS3 の XMLDocument（test/as3/xmldoc.as）の出力から確かめた。

// 解析の結果（AS2 の XML.status）。実機と同じ番号。
export const XML_STATUS = { ok: 0, cdata: -2, comment: -5, element: -6, unclosed: -9, unopened: -10 };
const MAX_NODES = 100000;

/**
 * 実体参照を文字にする。entities は名前 → 文字（AS2 と AS3 で &nbsp; の文字が違う）。知らない名前は、そのまま残す。
 */
export function unescapeXML(s, entities) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (all, name) => {
    if (name[0] !== '#') return entities[name] ?? all;
    const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
}

const ESCAPES = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };
export const escapeXML = (s) => s.replace(/[<>&"']/g, (c) => ESCAPES[c]);

/**
 * text を解析する。途中で誤りがあれば、そこまでの木を残して、status に理由を入れる。
 * options: ignoreWhite（空白だけの文字列を捨てる）、trimLeading（ignoreWhite のとき、残す文字列の先頭の空白も削る。AS3）、entities。
 * 戻り値: { children, xmlDecl, docTypeDecl, status }
 */
export function parseLegacyXML(text, { ignoreWhite = false, trimLeading = false, entities }) {
  const root = { type: 1, name: null, children: [] };
  const out = { children: root.children, xmlDecl: undefined, docTypeDecl: undefined, status: XML_STATUS.ok };
  const stack = [root];
  let count = 0;
  const add = (node) => {
    if (++count > MAX_NODES) return;
    stack[stack.length - 1].children.push(node);
  };
  const addText = (s) => {
    if (s === '' || (ignoreWhite && /^[ \t\r\n]*$/.test(s))) return;
    add({ type: 3, value: ignoreWhite && trimLeading ? s.replace(/^[ \t\r\n]+/, '') : s, children: [], attrs: [] });
  };
  const unescape = (s) => unescapeXML(s, entities);
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      addText(unescape(text.slice(i)));
      break;
    }
    addText(unescape(text.slice(i, lt)));
    const skipTo = (end, status) => {
      const at = text.indexOf(end, lt);
      if (at < 0) out.status = status;
      return at < 0 ? -1 : at + end.length;
    };
    if (text.startsWith('<!--', lt)) {
      i = skipTo('-->', XML_STATUS.comment);
    } else if (text.startsWith('<![CDATA[', lt)) {
      i = skipTo(']]>', XML_STATUS.cdata);
      if (i >= 0) addText(text.slice(lt + 9, i - 3));
    } else if (text.startsWith('<?', lt)) {
      i = skipTo('?>', XML_STATUS.element);
      if (i >= 0) out.xmlDecl = (out.xmlDecl ?? '') + text.slice(lt, i);
    } else if (text.startsWith('<!', lt)) {
      i = skipTo('>', XML_STATUS.element);
      if (i >= 0) out.docTypeDecl = (out.docTypeDecl ?? '') + text.slice(lt, i);
    } else if (text[lt + 1] === '/') {
      const gt = text.indexOf('>', lt);
      const name = gt < 0 ? '' : text.slice(lt + 2, gt).trim();
      if (gt < 0) out.status = XML_STATUS.element;
      else if (stack.length > 1 && stack[stack.length - 1].name === name) stack.pop();
      // 開いている要素のどれかの終了タグなら「閉じていない要素がある」、どれでもなければ「開始タグが無い」。
      else out.status = stack.slice(1).some((node) => node.name === name) ? XML_STATUS.unclosed : XML_STATUS.unopened;
      i = gt < 0 || out.status !== XML_STATUS.ok ? -1 : gt + 1;
    } else {
      // 開始タグ: 名前、属性（値は引用符で囲む）、> または />
      const head = /^<([^\s/>]+)/.exec(text.slice(lt, lt + 1024));
      let p = head ? lt + head[0].length : -1;
      const node = head ? { type: 1, name: head[1], attrs: [], children: [] } : null;
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
        node.attrs.push([rest[2], unescape(rest[4] ?? rest[5])]);
      }
      if (!node || !closed) {
        out.status = XML_STATUS.element;
        i = -1;
      } else {
        add(node);
        if (!selfClosing) stack.push(node);
        i = p;
      }
    }
    if (i < 0) return out;
  }
  if (stack.length > 1) out.status = XML_STATUS.unclosed;
  return out;
}
