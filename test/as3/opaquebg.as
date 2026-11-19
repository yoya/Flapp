// opaqueBackground（不透明な背景色）の値と描画
var s:Sprite = new Sprite();
var show:Function = function(v:*):void { s.opaqueBackground = v; trace(s.opaqueBackground, typeof s.opaqueBackground); };
trace(s.opaqueBackground);
show(0x123456); show(0xff654321); show(-1); show(1.5); show("0x10"); show("abc"); show(true); show(null); show(undefined); show(NaN);
s.graphics.beginFill(0xff0000); s.graphics.drawCircle(60, 60, 30); s.x = 20; s.y = 20; addChild(s);
show(0x00ff00);
var t:Shape = new Shape(); t.graphics.beginFill(0x0000ff, 0.5); t.graphics.drawRect(0, 0, 40, 30); t.x = 150; t.y = 40; t.rotation = 20; t.alpha = 0.5; t.opaqueBackground = 0xffff00; addChild(t);
