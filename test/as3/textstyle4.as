// StyleSheet のメソッド（setStyle の名前、parseCSS の同名セレクタ、transform）
var t:Function = function(name:String, f:Function):void { try { trace(name, f()); } catch (e:Error) { trace(name, "ERR", e.errorID); } };
var dump:Function = function(s:Object):String { if (s == null) return "null"; var o:Array = []; for (var k:String in s) o.push(k + "=" + s[k]); return o.sort().join(";"); };
var ss:StyleSheet = new StyleSheet();
t("merge", function():* { ss.parseCSS("p { color: #010203; } p { font-size: 12px; }"); return dump(ss.getStyle("p")); });
t("setStyle upper", function():* { ss.setStyle("Q", {color: "#111111"}); return [ss.styleNames.sort().join(","), dump(ss.getStyle("q")), dump(ss.getStyle("Q"))].join(" | "); });
t("setStyle replace", function():* { ss.setStyle("p", {x: "1"}); return dump(ss.getStyle("p")); });
t("setStyle hyphen", function():* { ss.setStyle("h", {"font-size": "10px", fontWeight: "bold"}); return dump(ss.getStyle("h")); });
t("getStyle copy", function():* { var a:Object = ss.getStyle("h"); a.color = "#fff"; return dump(ss.getStyle("h")); });
t("setStyle null", function():* { ss.setStyle("n", null); return [ss.styleNames.sort().join(","), dump(ss.getStyle("n"))].join(" | "); });
t("getStyle none", function():* { return ss.getStyle("zzz"); });
t("parse twice", function():* { var s4:StyleSheet = new StyleSheet(); s4.parseCSS("p{color:#1}"); s4.parseCSS("q{color:#2}"); return s4.styleNames.sort().join(","); });
t("transform plain", function():* { var s5:StyleSheet = new StyleSheet(); var f:TextFormat = s5.transform({color: "#ff0000", fontSize: "20px", marginLeft: "5px", textIndent: "3px", leading: "2px", display: "none", textAlign: "center", kerning: "true", letterSpacing: "1px", fontFamily: "sans-serif"}); return [f.color, f.size, f.leftMargin, f.indent, f.leading, f.display, f.align, f.kerning, f.letterSpacing, f.font].join(","); });
t("transform empty", function():* { var s6:StyleSheet = new StyleSheet(); return s6.transform({}) == null ? "null" : "fmt"; });
t("transform null", function():* { var s7:StyleSheet = new StyleSheet(); return s7.transform(null) == null ? "null" : "fmt"; });
