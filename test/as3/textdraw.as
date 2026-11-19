// 書式つきのテキストの描画（色・大きさ・太字・斜体・下線・位置揃え・箇条書き・字下げ・折り返し）。画面で実機と比べる
// size: 560x340
var n:int = 0;
var field:Function = function(w:int, h:int, wrap:Boolean):TextField {
  var tf:TextField = new TextField();
  tf.x = 10 + (n % 2) * 275; tf.y = 10 + int(n / 2) * 105;
  tf.width = w; tf.height = h; tf.multiline = true; tf.wordWrap = wrap; tf.border = true;
  addChild(tf); n++;
  return tf;
};
var f0:TextField = field(260, 30, false); f0.text = "Red Green Blue Big";
var r:TextFormat = new TextFormat(); r.color = 0xff0000; f0.setTextFormat(r, 0, 3);
var g:TextFormat = new TextFormat(); g.color = 0x00aa00; g.bold = true; f0.setTextFormat(g, 4, 9);
var b:TextFormat = new TextFormat(); b.color = 0x0000ff; b.italic = true; f0.setTextFormat(b, 10, 14);
var big:TextFormat = new TextFormat(); big.size = 22; f0.setTextFormat(big, 15, 18);
var f1:TextField = field(260, 30, false); f1.htmlText = "<b>bold</b> <i>italic</i> <u>under</u> <font color='#cc0000' size='18'>red18</font> <a href='http://a/'>link</a>";
var f2:TextField = field(260, 100, true); f2.htmlText = "<p align='left'>left para one two three four five six</p><p align='center'>centered</p><p align='right'>right aligned para</p>";
var f3:TextField = field(260, 100, true); f3.htmlText = "<li>first item</li><li>second item</li><li>third</li>";
var f4:TextField = field(260, 100, true); f4.htmlText = "<textformat leftmargin='20' indent='-10' leading='6'>hanging indent line one two three four five six seven eight nine ten</textformat>";
var f5:TextField = field(260, 100, false); f5.htmlText = "<font letterspacing='3'>spaced text</font><br><font size='8'>small</font> <font size='24'>BIG</font><br><b><i><u>all three</u></i></b>";
trace("done");
