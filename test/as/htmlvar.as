// HTML のテキストと連動する変数（AS2）。実機の値を測る
// frames: 3
var f = function(t, a, b) { var x = t.getTextFormat(a, b); return [x.size, x.color, x.bold].join("/"); };
this.createTextField("tf", 1, 10, 10, 300, 100);
tf.html = true;
tf.htmlText = "<font size='20' color='#ff0000'>abc</font>";
trace("init [" + tf.text + "] " + f(tf, 0, 1));
tf.variable = "v";
v = "<b>xy</b>zw";
this.createTextField("pt", 2, 10, 110, 300, 40);
pt.htmlText = "<font size='20' color='#ff0000'>abc</font>";
pt.variable = "w";
w = "<b>xy</b>zw";
//// frame 2
trace("html [" + tf.text + "] " + tf.htmlText);
trace("html fmt " + f(tf, 0, 1) + " | " + f(tf, 3, 4));
trace("plain [" + pt.text + "] " + f(pt, 0, 1));
v = "plain1";
//// frame 3
stop();
trace("html2 [" + tf.text + "] " + f(tf, 0, 1));
trace("v " + v);
tf.htmlText = "<font size='20' color='#00ff00'>q</font>";
trace("after htmlText v=" + v + " " + f(tf, 0, 1));
tf.text = "r";
trace("after text v=" + v + " " + f(tf, 0, 1));
tf.htmlText = "<font size='20' color='#00ff00'>s</font>";
var me = this;
var n = 0;
this.onEnterFrame = function() { if (++n == 2) { trace("later [" + me.tf.text + "] " + f(me.tf, 0, 1) + " v=" + me.v); delete me.onEnterFrame; } };
