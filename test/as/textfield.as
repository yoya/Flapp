// TextField: createTextField で作ったフィールドのプロパティ、変数との連動、TextFormat
// frames: 3
this.createTextField("tf", 1, 10, 20, 100, 40);
trace("typeof " + typeof tf + " [" + tf + "] instanceof " + (tf instanceof TextField) + " depth=" + tf.getDepth() + " name=" + tf._name + " target=" + tf._target + " parent=" + tf._parent);
trace("pos " + tf._x + "," + tf._y + " size " + tf._width + "x" + tf._height + " vis=" + tf._visible + " alpha=" + tf._alpha + " rot=" + tf._rotation + " xs=" + tf._xscale + "," + tf._yscale);
trace("text=[" + tf.text + "] length=" + tf.length + " type=" + tf.type + " html=" + tf.html + " multiline=" + tf.multiline + " wordWrap=" + tf.wordWrap + " selectable=" + tf.selectable);
trace("border=" + tf.border + " background=" + tf.background + " password=" + tf.password + " embedFonts=" + tf.embedFonts + " autoSize=" + tf.autoSize + " maxChars=" + tf.maxChars);
trace("textColor=" + tf.textColor + " borderColor=" + tf.borderColor + " backgroundColor=" + tf.backgroundColor + " variable=" + tf.variable + " restrict=" + tf.restrict + " condenseWhite=" + tf.condenseWhite + " mouseWheelEnabled=" + tf.mouseWheelEnabled);
trace("scroll=" + tf.scroll + " maxscroll=" + tf.maxscroll + " hscroll=" + tf.hscroll + " maxhscroll=" + tf.maxhscroll + " bottomScroll=" + tf.bottomScroll + " textWidth=" + tf.textWidth + " textHeight=" + tf.textHeight);
tf.text = "hello"; trace("text=[" + tf.text + "] length=" + tf.length + " html=[" + tf.htmlText + "] sized=" + (tf.textWidth > 0) + "," + (tf.textHeight > 0));
tf.text = 123; trace("number -> [" + tf.text + "] " + typeof tf.text);
tf.text = undefined; trace("undefined -> [" + tf.text + "]");
tf.text = null; trace("null -> [" + tf.text + "]");
tf.text = "a\nb\rc"; trace("lines -> length=" + tf.length + " codes=" + tf.text.charCodeAt(1) + "," + tf.text.charCodeAt(3));
tf.textColor = 0xff0000; trace("textColor=" + tf.textColor);
tf.textColor = -1; trace("textColor=" + tf.textColor);
tf.type = "input"; trace("type=" + tf.type); tf.type = "bogus"; trace("type=" + tf.type); tf.type = "DYNAMIC"; trace("type=" + tf.type);
tf.autoSize = true; trace("autoSize=" + tf.autoSize); tf.autoSize = "center"; trace("autoSize=" + tf.autoSize); tf.autoSize = "RIGHT"; trace("autoSize=" + tf.autoSize);
tf.autoSize = "bogus"; trace("autoSize=" + tf.autoSize); tf.autoSize = false; trace("autoSize=" + tf.autoSize);
tf.border = true; tf.background = 1; tf.borderColor = 0x123456; tf.backgroundColor = "255"; tf.maxChars = 5; tf.password = "yes"; tf.multiline = 0;
trace("set: " + tf.border + " " + tf.background + " " + tf.borderColor + " " + tf.backgroundColor + " " + tf.maxChars + " " + tf.password + " " + tf.multiline);
tf.maxChars = 0; trace("maxChars 0 -> " + tf.maxChars); tf.maxChars = -3; trace("maxChars -3 -> " + tf.maxChars);
tf._x = 50; tf._width = 200; tf._height = 10; trace("moved " + tf._x + "," + tf._y + " " + tf._width + "x" + tf._height + " xs=" + tf._xscale);
tf._xscale = 200; trace("scaled " + tf._width + "x" + tf._height + " xs=" + tf._xscale);
tf._xscale = 100;
// 変数との連動
tf.text = "start";
tf.variable = "v"; trace("bound: variable=" + tf.variable + " v=[" + v + "] text=[" + tf.text + "]");
v = "from var"; trace("after v set: text=[" + tf.text + "]");
tf.text = "to var"; trace("after text set: v=[" + v + "]");
// TextFormat
var fmt = tf.getTextFormat();
function fmtText(f) { return f.font + " " + f.size + " " + f.color + " " + f.bold + " " + f.italic + " " + f.underline + " " + f.align + " " + f.leftMargin + " " + f.rightMargin + " " + f.indent + " " + f.leading + " [" + f.url + "] [" + f.target + "] " + f.bullet + " " + f.tabStops; }
trace("format " + typeof fmt + " " + (fmt instanceof TextFormat) + ": " + fmtText(fmt));
trace("new format: " + fmtText(tf.getNewTextFormat()));
var f2 = new TextFormat("Arial", 20, 0x0000ff, true, false, true, "http://x/", "_blank", "center", 1, 2, 3, 4);
trace("constructed: " + fmtText(f2));
trace("empty: " + fmtText(new TextFormat()));
tf.setTextFormat(f2); trace("after setTextFormat: " + fmtText(tf.getTextFormat()) + " | new: " + fmtText(tf.getNewTextFormat()));
tf.text = "replaced"; trace("after text change: " + fmtText(tf.getTextFormat()));
tf.setNewTextFormat(f2); tf.text = "again"; trace("after setNewTextFormat: " + fmtText(tf.getTextFormat()));
var names = "";
for (var k in this) { names += k + " "; }
trace("root keys: " + names);
//// frame 2
trace("frame 2: text=[" + tf.text + "] v=[" + v + "]");
v = "second";
trace("same frame: text=[" + tf.text + "]");
this.createTextField("tf", 1, 0, 0, 10, 10);
trace("recreated: [" + tf.text + "] " + tf._width);
this.createTextField("other", 2, 0, 0, 50, 20);
other.text = "x";
other.removeTextField(); trace("removed: [" + other + "] " + typeof other + " [" + other.text + "]");
var made = this.createTextField("ret", 3, 0, 0, 50, 20); trace("createTextField returns " + made);
//// frame 3
trace("frame 3: text=[" + tf.text + "] v=[" + v + "]");
stop();
