// 端末のフォントの行の寸法（汎用の名前と日本語の名前）。大きさを細かく変えて測る
var tf:TextField = new TextField(); tf.multiline = true; tf.width = 300; tf.height = 400; addChild(tf);
for each (var name:String in ["_sans", "_serif", "_typewriter", "_ゴシック", "_明朝", "_等幅", "ＭＳ Ｐゴシック", "Osaka"]) {
  var row:Array = [name];
  for each (var size:int in [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 36, 48, 72]) {
    var f:TextFormat = new TextFormat(); f.size = size; f.font = name;
    tf.defaultTextFormat = f;
    tf.text = "a";
    var m:TextLineMetrics = tf.getLineMetrics(0);
    row.push(size + ":" + m.ascent + "/" + m.descent);
  }
  trace(row.join(" "));
}
