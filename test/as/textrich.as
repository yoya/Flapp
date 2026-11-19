// AS2 の TextField: 範囲ごとの書式、html の読み書き、newTextFormat、replaceText。実機の値を測る
// swf: 8
var tf = _root.createTextField("tf", 1, 0, 0, 200, 100);
tf.multiline = true;
function fmt(a, b) { var f = (b == undefined) ? (a == undefined ? tf.getTextFormat() : tf.getTextFormat(a)) : tf.getTextFormat(a, b); return [f.font, f.size, f.color, f.bold, f.italic, f.underline, f.url, f.target, f.align, f.leftMargin, f.indent, f.leading, f.bullet, f.letterSpacing, f.kerning, f.display].join("/"); }
function esc(s) { return s.split("\r").join("\\r").split("\n").join("\\n"); }
tf.text = "abcdef";
trace("default " + fmt(0, 6));
var b = new TextFormat(); b.bold = true;
trace("set range " + tf.setTextFormat(2, 4, b));
trace("range " + [fmt(0, 2), fmt(2, 4), fmt(4, 6), fmt(0, 6), fmt()].join(" | "));
trace("one index " + [fmt(1), fmt(2), fmt(3), fmt(4)].join(" | "));
var c = new TextFormat(); c.color = 0xff0000;
tf.setTextFormat(3, c);
trace("set index " + [fmt(2), fmt(3), fmt(4)].join(" | "));
tf.setTextFormat(c);
trace("whole " + fmt(0, 6));
trace("out of range " + [fmt(7, 9), fmt(4, 99), fmt(4, 2), fmt(-1, 2)].join(" | "));
tf.html = true;
tf.htmlText = "<b>x</b><i>y</i><u>z</u><font color='#ff0000' size='20' face='Arial'>w</font><a href='http://a/' target='t'>l</a>";
trace("html text " + esc(tf.text));
trace("html out " + tf.htmlText);
trace("html fmt " + [fmt(0, 1), fmt(1, 2), fmt(2, 3), fmt(3, 4), fmt(4, 5)].join(" | "));
tf.htmlText = "<p align='center'>a</p><p align='right'>b</p>c<br>d<li>e</li>";
trace("html p " + esc(tf.text));
trace("html p out " + tf.htmlText);
tf.htmlText = "a&amp;b &lt;c&gt; &quot;d&quot;";
trace("entities " + tf.text + " | " + tf.htmlText);
tf.html = false;
tf.text = "<b>plain</b>";
trace("not html " + tf.text + " | " + tf.htmlText);
tf.html = true;
tf.text = "a<b>";
trace("html text set " + tf.htmlText);
tf.text = "abcdef";
tf.setTextFormat(2, 4, b);
tf.replaceText(3, 3, "ZZ");
trace("replaceText " + [tf.text, fmt(2), fmt(3), fmt(4), fmt(5), fmt(6)].join(" | "));
var n = new TextFormat(); n.size = 22; n.color = 0x00ff00;
tf.setNewTextFormat(n);
tf.text = "new";
trace("newTextFormat " + fmt(0, 3) + " | " + tf.getNewTextFormat().size);
tf.text = "";
trace("empty " + tf.getTextFormat().size + " " + tf.getTextFormat(0).size + " " + tf.getTextFormat(0, 0).size);
trace("done");
