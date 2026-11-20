// 端末のフォントの行の寸法（フォントの名前ごと）。getLineMetrics と textHeight から測る
var tf:TextField = new TextField(); tf.multiline = true; tf.width = 300; tf.height = 400; addChild(tf);
for each (var name:String in ["_sans", "_serif", "_typewriter", "Arial", "Helvetica", "Courier", "Times", "NoSuchFont"]) {
  for each (var size:int in [10, 12, 20, 30, 48]) {
    var f:TextFormat = new TextFormat(); f.size = size; f.font = name;
    tf.defaultTextFormat = f;
    tf.text = "a\rb\rc\rd";
    var h4:Number = tf.textHeight;
    var m:TextLineMetrics = tf.getLineMetrics(0);
    trace(name, size, h4, m.height, m.ascent, m.descent, m.leading);
  }
}
