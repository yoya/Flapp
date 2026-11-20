// 行の高さ（フォントの大きさごと）。textHeight と getLineMetrics から測る
var tf:TextField = new TextField(); tf.multiline = true; tf.width = 300; tf.height = 400; addChild(tf);
for each (var size:int in [6, 8, 10, 11, 12, 13, 14, 16, 18, 20, 24, 30, 36, 48, 72]) {
  var f:TextFormat = new TextFormat(); f.size = size; f.font = "Times Roman";
  tf.defaultTextFormat = f;
  tf.text = "a";
  var h1:Number = tf.textHeight;
  tf.text = "a\rb";
  var h2:Number = tf.textHeight;
  tf.text = "a\rb\rc\rd";
  var h4:Number = tf.textHeight;
  var m:TextLineMetrics = tf.getLineMetrics(0);
  trace(size, h1, h2, h4, m.height, m.ascent, m.descent, m.leading);
}
