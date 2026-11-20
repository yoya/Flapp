// StyleSheet のタグ・クラスの当たり方、あとから変えたとき、入れ子。実機の値を測る
var t:Function = function(name:String, f:Function):void { try { trace(name, f()); } catch (e:Error) { trace(name, "ERR", e.errorID); } };
var tf:TextField = new TextField(); addChild(tf); tf.width = 300; tf.height = 100; tf.multiline = true; tf.wordWrap = true;
var ss:StyleSheet = new StyleSheet();
ss.parseCSS("em { font-style: italic; } strong { font-weight: bold; } span { color: #ff0000; } div { color: #00ff00; } i { color: #0000ff; } b { color: #123456; font-size: 30px; } u { color: #654321; } .x { font-size: 40px; } .y { color: #ff00ff; } font { color: #111111; } br { color: #222222; } a { color: #333333; } p { margin-left: 8px; } ul { color: #444444; } img { color: #555555; } textformat { color: #666666; } .none { display: none; } .inl { display: inline; } .blk { display: block; } .und { text-decoration: underline; } .ls { letter-spacing: 3px; } .kern { kerning: true; } .ind { text-indent: 12px; } .fs { font-family: Courier; font-size: 18pt; } .fw { font-weight: normal; } .fm { font-weight: 700; font-style: normal; } .al { text-align: right; } .ml { margin-left: 4px; margin-right: 7px; } .pc { font-size: 150%; } .col3 { color: #f0f; } .col4 { color: red; } .upper { color: #ABCDEF; }");
var fmt:Function = function(a:int, b:int):String { var f:TextFormat = tf.getTextFormat(a, b); return [f.font, f.size, f.color, f.bold, f.italic, f.underline, f.url, f.align, f.leftMargin, f.rightMargin, f.indent, f.leading, f.bullet, f.letterSpacing, f.kerning, f.display].join("/"); };
var show:Function = function(s:String):String { return s.split("\r").join("\\r").split("\n").join("\\n"); };
tf.styleSheet = ss;
var one:Function = function(html:String):String { tf.htmlText = html; return show(tf.text) + " | " + fmt(0, 1) + " | " + (tf.text.length > 1 ? fmt(tf.text.length - 1, tf.text.length) : ""); };
for each (var tag:String in ["em", "strong", "span", "div", "i", "b", "u", "font", "a", "ul", "textformat", "p", "unknown"]) {
  t("tag " + tag, function():* { return one("<" + tag + ">a</" + tag + ">z"); });
}
t("tag li", function():* { return one("<li>a</li>z"); });
t("tag br", function():* { return one("a<br>z"); });
for each (var cls:String in ["x", "y", "none", "inl", "blk", "und", "ls", "kern", "ind", "fs", "fw", "fm", "al", "ml", "pc", "col3", "col4", "upper", "missing"]) {
  t("class " + cls, function():* { return one("<span class='" + cls + "'>a</span>z"); });
}
t("class on p", function():* { return one("<p class='x'>a</p>z"); });
t("class on b", function():* { return one("<b class='y'>a</b>z"); });
t("class case", function():* { return one("<span class='X'>a</span>z"); });
t("class two", function():* { return one("<span class='x y'>a</span>z"); });
t("class double quote", function():* { return one("<span class=\"x\">a</span>z"); });
t("nested", function():* { tf.htmlText = "<span class='x'>a<span class='y'>b</span>c</span>d"; return [fmt(0, 1), fmt(1, 2), fmt(2, 3), fmt(3, 4)].join(" | "); });
t("nested b in span", function():* { tf.htmlText = "<span class='x'>a<b>b</b>c</span>d"; return [fmt(0, 1), fmt(1, 2), fmt(2, 3), fmt(3, 4)].join(" | "); });
t("p then plain", function():* { tf.htmlText = "<p>a</p>b<p>c</p>"; return [show(tf.text), fmt(0, 1), fmt(2, 3), fmt(3, 4)].join(" | "); });
t("p default in sheet", function():* { tf.htmlText = "<p>ab</p>"; return fmt(0, 2); });
t("html out", function():* { return show(tf.htmlText); });
t("link states", function():* { var s3:StyleSheet = new StyleSheet(); s3.parseCSS("a:link { color: #0000ff; } a:hover { color: #ff0000; text-decoration: underline; } a:active { color: #00ff00; }"); tf.styleSheet = s3; tf.htmlText = "<a href='x'>a</a>"; return fmt(0, 1); });
t("link no a", function():* { var s4:StyleSheet = new StyleSheet(); s4.parseCSS("a:hover { color: #ff0000; }"); tf.styleSheet = s4; tf.htmlText = "<a href='x'>a</a>"; return fmt(0, 1); });
t("re-sheet change", function():* { var s5:StyleSheet = new StyleSheet(); s5.setStyle("p", {color: "#111111"}); tf.styleSheet = s5; tf.htmlText = "<p>a</p>"; var before:String = fmt(0, 1); s5.setStyle("p", {color: "#999999"}); return before + " -> " + fmt(0, 1); });
t("re-sheet clear", function():* { var s6:StyleSheet = new StyleSheet(); s6.setStyle("p", {color: "#111111"}); tf.styleSheet = s6; tf.htmlText = "<p>a</p>"; s6.clear(); return fmt(0, 1); });
t("sheet swap", function():* { var s7:StyleSheet = new StyleSheet(); s7.setStyle("p", {color: "#222222"}); tf.htmlText = "<p>a</p>"; var a:String = fmt(0, 1); tf.styleSheet = s7; return a + " -> " + fmt(0, 1) + " " + show(tf.htmlText); });
t("text with p", function():* { tf.text = "<p>q</p>r"; return [show(tf.text), show(tf.htmlText), fmt(0, 1)].join(" | "); });
t("text with entity", function():* { tf.text = "a &amp; b"; return [show(tf.text), show(tf.htmlText)].join(" | "); });
t("text plain lt", function():* { tf.text = "1 < 2"; return [show(tf.text), show(tf.htmlText)].join(" | "); });
t("empty", function():* { tf.htmlText = ""; return [show(tf.text), show(tf.htmlText), tf.length].join(" | "); });
t("replaceText", function():* { tf.htmlText = "<p>abc</p>"; tf.replaceText(0, 1, "Z"); return "ok"; });
t("getTextFormat nothing", function():* { tf.htmlText = "<p>abc</p>"; return fmt(0, 3); });
t("set type", function():* { tf.type = TextFieldType.INPUT; tf.htmlText = "<p>abc</p>"; return [tf.type, fmt(0, 1)].join(" "); });
t("restrict", function():* { tf.restrict = "a-z"; return tf.restrict; });
t("htmlText getter plain", function():* { tf.htmlText = "plain"; return show(tf.htmlText); });
t("css parse", function():* { var s8:StyleSheet = new StyleSheet(); s8.parseCSS("P { color: #010203; } .A-b { color: #040506; } /* c */ h1,h2 { color: #070809; } p { font-size: 12px }"); return s8.styleNames.sort().join(",") + " " + s8.getStyle("p").fontSize + " " + s8.getStyle("h1").color; });
