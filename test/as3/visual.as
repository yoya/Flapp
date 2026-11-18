// unverified: 画面で見た目を確かめるためのムービー。表示オブジェクトの BitmapData.draw は、描画側（ブラウザ）が無いとできない
var bd:BitmapData = new BitmapData(8, 8, true, 0xff3366cc);
for (var i:int = 0; i < 8; i++) { bd.setPixel32(i, i, 0xffffcc00); bd.setPixel32(7 - i, i, 0x80ffffff); }
var bmp:Bitmap = new Bitmap(bd); bmp.x = 10; bmp.y = 10; bmp.scaleX = bmp.scaleY = 6; addChild(bmp);
var art:Sprite = new Sprite(); art.graphics.beginFill(0xcc3333); art.graphics.drawCircle(20, 20, 18); art.graphics.endFill(); art.graphics.lineStyle(3, 0x003300); art.graphics.moveTo(0, 0); art.graphics.lineTo(40, 40);
var shot:BitmapData = new BitmapData(40, 40, true, 0x20000000); shot.draw(art);
var shown:Bitmap = new Bitmap(shot); shown.x = 70; shown.y = 10; addChild(shown);
var big:Bitmap = new Bitmap(shot); big.x = 120; big.y = 10; big.scaleX = big.scaleY = 2; big.alpha = 0.5; addChild(big);
trace("center", shot.getPixel32(20, 20).toString(16), "corner", shot.getPixel32(39, 0).toString(16));
var tf:TextField = new TextField(); tf.x = 10; tf.y = 70; tf.width = 180; tf.height = 22; tf.border = true; tf.background = true; tf.backgroundColor = 0xffffee; tf.textColor = 0x0000aa; tf.text = "TextField " + bd.width + "x" + bd.height; addChild(tf);
var rect:Function = function(color:uint, w:Number):Shape { var s:Shape = new Shape(); s.graphics.beginFill(color); s.graphics.drawRect(0, 0, w, 24); return s; };
var button:SimpleButton = new SimpleButton(rect(0x999999, 60), rect(0x33aa33, 70), rect(0xaa3333, 80), rect(0, 60)); button.x = 10; button.y = 110; addChild(button);
var frame:int = 0;
addEventListener(Event.ENTER_FRAME, function(e:Event):void { frame++; bd.setPixel32(frame % 8, 0, 0xffff0000); bd.setPixel32((frame + 7) % 8, 0, 0xff3366cc); tf.text = "frame " + frame; });
