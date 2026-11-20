// 枠より広い文字列の位置揃えと切り取り（AS2）。画面を実機と比べる
// size: 240x160
// frames: 1
stop();
var aligns = ["left", "center", "right"];
var i = 0;
for (; i < 3; i++) {
  var t = this.createTextField("t" + i, i + 1, 60, 10 + i * 30, 40, 20);
  t.background = true;
  t.backgroundColor = 0xffff00;
  var f = new TextFormat();
  f.font = "_sans";
  f.size = 12;
  f.align = aligns[i];
  t.setNewTextFormat(f);
  t.text = "ABCDEFGHIJ";
}
var m = this.createTextField("m", 10, 60, 100, 40, 40);
m.background = true;
m.backgroundColor = 0x00ffff;
m.multiline = true;
var g = new TextFormat();
g.font = "_sans";
g.size = 12;
g.align = "center";
m.setNewTextFormat(g);
m.text = "AB\rABCDEFGHIJ";
var v = this.createTextField("v", 11, 140, 10, 60, 22);
v.background = true;
v.backgroundColor = 0xff00ff;
v.multiline = true;
var k = new TextFormat();
k.font = "_sans";
k.size = 12;
v.setNewTextFormat(k);
v.text = "gyq\rgyq\rgyq";
trace("v maxscroll " + v.maxscroll); // 文字の幅や高さは端末のフォントで変わるので、画面で比べる
var e = this.createTextField("e", 12, 140, 60, 60, 10);
e.background = true;
e.backgroundColor = 0xff00ff;
e.setNewTextFormat(k);
e.text = "Wgy";
