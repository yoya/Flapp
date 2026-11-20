// <img> タグ: text / htmlText / 書式の往復。画像の読み込みには依存しない値だけ（画像の配置は textimg2 / textimg3 の画面で測った）
// swf: 8
// size: 320x240
// sprite: 1 frames 1 export sym square 40
// frames: 1
stop();
this.createTextField("t", 1, 10, 10, 300, 200); t.html = true; t.multiline = true; t.wordWrap = true; t.border = true;
var info = function() {
  return "len=" + t.text.length + " [" + t.text.split("\r").join("\\r") + "]";
};
var show = function(h) { t.htmlText = h; trace(info()); trace(t.htmlText); };
show('ab<img src="pic.png" width="40" height="30" id="im1">cd');
var f = t.getTextFormat(2, 3);
trace("fmt: " + [f.font, f.size, f.color, f.bold, f.url].join("/"));
f = t.getTextFormat(1, 2);
trace("fmt: " + [f.font, f.size, f.color, f.bold, f.url].join("/"));
show('x<img src="sym" width="20" height="20" id="s1">y<img src="sym" hspace="10" vspace="5" align="left">z<img src="missing.png" width="10" height="10">w');
show('<img src="pic.gif">|<img src="pic.jpg">|<img src="pic.png" width="12">|<img src="pic.png" height="12">|<img src="pic.png">');
show('<b>bold<img src="a.png" width="5" height="5">bold</b>');
show('<a href="u"><img src="a.png"></a>');
show('<p align="right">r<img src="a.png" align="RIGHT" hspace="3" vspace="4"></p>');
show('<img>');
show('<img src="">');
show('a<IMG SRC="A.png" WIDTH="5" HEIGHT="6">b');
show('<font size="20">big<img src="a.png"></font>after');
t.htmlText = 'ab<img src="a.png" width="5" height="5">cd';
t.replaceText(1, 3, "ZZ");
trace(t.htmlText);
trace(t.text.length);
