// StyleSheet.parseCSS の、書き方の崩れたときの扱い。実機の値を測る
var t:Function = function(name:String, f:Function):void { try { trace(name, f()); } catch (e:Error) { trace(name, "ERR", e.errorID); } };
var dump:Function = function(s:Object):String { if (s == null) return "null"; var o:Array = []; for (var k:String in s) o.push(k + "=" + s[k]); return o.sort().join(";"); };
var cases:Array = [
  "p { color: #ff0000; }",
  "p{color:#ff0000}",
  "p { color : #ff0000; }",
  "p { color: #ff0000 ; }",
  "p { color : #ff0000 }",
  "a : hover { color: #ff0000; }",
  "a:hover { color: #ff0000; }",
  "  a  :  hover  { color: #ff0000; }",
  "\np\n{\ncolor: #ff0000;\n}\n",
  ".k , .l { color: #0000ff; }",
  ".k,.l { color: #0000ff; }",
  "p { color #ff0000; font-size: 9px }",
  "p { font-size: 9px; color #ff0000 }",
  "p { ; font-size: 9px }",
  "p { font-size: 9px;; }",
  "p { : x; font-size: 9px }",
  "p { a: ; font-size: 9px }",
  "q {} p { font-size: 9px }",
  "p { font-size: 9px } @media x { s { color: red } }",
  "p { font-size: 9px } p2 { color: ",
  "p { font-size: 9px } x",
  "p { font-size: 9px; } /* c */ q { font-size: 8px; }",
  "p { font-size: 9px; /* c */ color: #123456; }",
  "P { font-size: 9px; } .A { color: #123456; }",
  "p { FONT-SIZE: 9px; Font-Weight: bold }",
  "p { font-size: 9px; font-size: 10px }",
  "p { color: #FF0000; }",
  "p { font-family: Arial, sans-serif; }",
  "p { font-family: \"A b\"; }",
  "p { color: #ff0000 !important; }",
  "p, q { font-size: 9px }",
  "p q { font-size: 9px }",
  "p.x { font-size: 9px }",
  "#id { font-size: 9px }",
  "* { font-size: 9px }",
  "p { font-size: 9px } p { color: #123456 }"
];
for (var i:int = 0; i < cases.length; i++) {
  var s:StyleSheet = new StyleSheet();
  var r:String;
  try { s.parseCSS(cases[i]); var names:Array = s.styleNames.slice().sort(); var parts:Array = []; for each (var n:String in names) parts.push(n + "{" + dump(s.getStyle(n)) + "}"); r = parts.join(" "); } catch (e:Error) { r = "ERR " + e.errorID; }
  trace(i, r);
}
