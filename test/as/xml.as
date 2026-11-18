// XML / XMLNode: 解析、ノードの読み書き、文字列化
// frames: 4
var x = new XML("<a x=\"1\" y='2'><b>text</b><c/><!-- comment --><d>t1<e/>t2</d></a>");
trace("typeof " + typeof x + " " + (x instanceof XML) + " " + (x instanceof XMLNode) + " status=" + x.status + " loaded=" + x.loaded + " type=" + x.nodeType + " name=" + x.nodeName + " value=" + x.nodeValue);
trace("toString " + x.toString());
trace("concat " + x);
var a = x.firstChild;
trace("a: name=" + a.nodeName + " type=" + a.nodeType + " value=" + a.nodeValue + " x=" + a.attributes.x + " y=" + a.attributes.y + " children=" + a.childNodes.length + " has=" + a.hasChildNodes() + " typeof childNodes=" + typeof a.childNodes + " " + (a.childNodes instanceof Array));
var b = a.firstChild;
trace("b: " + b.nodeName + " child type=" + b.firstChild.nodeType + " [" + b.firstChild.nodeValue + "] name=" + b.firstChild.nodeName + " next=" + b.nextSibling.nodeName + " prev=" + b.previousSibling + " parent=" + b.parentNode.nodeName + " last=" + a.lastChild.nodeName + " has=" + b.firstChild.hasChildNodes());
trace("d: " + a.lastChild.childNodes.length + " [" + a.lastChild.firstChild.nodeValue + "] " + a.lastChild.childNodes[1].nodeName + " [" + a.lastChild.lastChild + "] parent of root=" + x.parentNode + " " + a.parentNode.nodeName);
var names = "";
for (var k in a.attributes) { names += k + "=" + a.attributes[k] + " "; }
trace("attributes: " + names);
var w1 = new XML("<a> <b> x </b>\n<c/> </a>");
var w2 = new XML(); w2.ignoreWhite = true; w2.parseXML("<a> <b> x </b>\n<c/> </a>");
trace("white: " + w1.firstChild.childNodes.length + " " + w2.firstChild.childNodes.length + " [" + w2.firstChild.firstChild.firstChild.nodeValue + "] " + w2.toString() + " ignoreWhite=" + w1.ignoreWhite);
var en = new XML("<a t=\"&lt;&amp;&quot;&gt;'\">&lt;x&gt; &amp; &apos; &quot; &#65; &nbsp;</a>");
trace("entities: [" + en.firstChild.attributes.t + "] [" + en.firstChild.firstChild.nodeValue + "] " + en.toString());
var cd = new XML("<a><![CDATA[<raw> & stuff]]>tail</a>");
trace("cdata: " + cd.firstChild.childNodes.length + " [" + cd.firstChild.firstChild.nodeValue + "] " + cd.toString());
var decl = new XML("<?xml version=\"1.0\"?><!DOCTYPE note SYSTEM \"n.dtd\"><a/>");
trace("decl: [" + decl.xmlDecl + "] [" + decl.docTypeDecl + "] " + decl.toString() + " children=" + decl.childNodes.length);
var doc = new XML();
var n = doc.createElement("root");
n.attributes.id = "1"; n.attributes.name = "a<b>\"c\"";
var t = doc.createTextNode("hi <there> & \"you\"");
n.appendChild(t); doc.appendChild(n);
trace("built: " + doc.toString() + " [" + t.nodeValue + "] " + t.nodeType + " " + (t instanceof XMLNode) + " " + doc.childNodes.length);
var e1 = doc.createElement("first"); var e2 = doc.createElement("second");
n.insertBefore(e1, t); n.appendChild(e2); trace("insert: " + doc.toString());
n.appendChild(e1); trace("move: " + doc.toString());
e2.removeNode(); trace("remove: " + doc.toString() + " parent=" + e2.parentNode);
var c1 = n.cloneNode(true); var c2 = n.cloneNode(false);
trace("clone: " + c1.toString() + " | " + c2.toString() + " parent=" + c1.parentNode + " same=" + (c1 == n));
t.nodeValue = "changed"; n.nodeName = "renamed"; trace("edit: " + doc.toString() + " clone still " + c1.toString());
trace("status: " + new XML("<a><b></a>").status + " " + new XML("<a").status + " " + new XML("<a></b>").status + " " + new XML("<a x=1/>").status + " " + new XML("text only").status + " " + new XML("<a><!-- x </a>").status + " " + new XML("<a><![CDATA[x</a>").status + " " + new XML("").status + " " + new XML("<a/><b/>").status);
trace("bad: " + new XML("<a><b></a>").toString() + " | " + new XML("text only").toString() + " | " + new XML("<a/><b/>").toString());
var nd = new XMLNode(1, "el"); var tx = new XMLNode(3, "plain");
trace("XMLNode: " + nd.toString() + " " + tx.toString() + " " + nd.nodeType + " " + tx.nodeName + " " + typeof nd.attributes);
x.parseXML("<z k='v'/>"); trace("parseXML: " + x.toString() + " " + x.childNodes.length + " " + x.status);
trace("content: " + x.contentType + " " + x.getBytesLoaded() + " " + x.getBytesTotal() + " " + typeof x.load + " " + typeof x.send);
x.onLoad = function(ok) { trace("xml onLoad " + ok + " loaded=" + this.loaded + " status=" + this.status); };
trace("load returns " + x.load("no-such-file.xml") + " loaded=" + x.loaded);
trace("self closing: " + new XML("<a></a>").toString() + " " + new XML("<a>  </a>").toString() + " " + new XML("<A B=\"c\"/>").firstChild.nodeName + " " + new XML("<a:b xmlns:a='u'/>").firstChild.nodeName);
//// frame 4
trace("frame 4");
stop();
