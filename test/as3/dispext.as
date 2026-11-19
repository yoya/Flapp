// mask・blendMode・scrollRect・scale9Grid・hitArea が画面と当たり判定に効くか。画面で実機と比べる
// size: 560x340
var n:int = 0;
var cell:Function = function():Sprite {
  var s:Sprite = new Sprite();
  s.x = 10 + (n % 5) * 110; s.y = 10 + int(n / 5) * 110;
  addChild(s); n++;
  return s;
};
var art:Function = function(s:Sprite):void {
  var g:Graphics = s.graphics;
  g.beginFill(0xff0000); g.drawRect(0, 0, 60, 60); g.endFill();
  g.beginFill(0x0000ff); g.drawCircle(60, 60, 30); g.endFill();
  g.lineStyle(2, 0x000000); g.moveTo(0, 0); g.lineTo(100, 100);
};
var back:Function = function(s:Sprite):void { var g:Graphics = s.graphics; g.beginFill(0xffee88); g.drawRect(0, 0, 100, 100); g.endFill(); };
// 0: mask（円）
var s0:Sprite = cell(); art(s0); var m0:Sprite = new Sprite(); m0.graphics.beginFill(0); m0.graphics.drawCircle(40, 40, 35); m0.graphics.endFill(); s0.addChild(m0); s0.mask = m0;
// 1: mask をはずす
var s1:Sprite = cell(); art(s1); var m1:Sprite = new Sprite(); m1.graphics.beginFill(0); m1.graphics.drawCircle(40, 40, 35); m1.graphics.endFill(); s1.addChild(m1); s1.mask = m1; s1.mask = null;
// 2〜6: blendMode
var modes:Array = [BlendMode.MULTIPLY, BlendMode.ADD, BlendMode.SUBTRACT, BlendMode.DIFFERENCE, BlendMode.INVERT];
for each (var bm:String in modes) { var b:Sprite = cell(); back(b); var f:Sprite = new Sprite(); art(f); b.addChild(f); f.blendMode = bm; }
// 7: layer + alpha
var s7:Sprite = cell(); back(s7); var l7:Sprite = new Sprite(); art(l7); l7.alpha = 0.5; l7.blendMode = BlendMode.LAYER; s7.addChild(l7);
// 8: erase
var s8:Sprite = cell(); var h8:Sprite = new Sprite(); h8.blendMode = BlendMode.LAYER; var bk8:Sprite = new Sprite(); back(bk8); h8.addChild(bk8); var e8:Sprite = new Sprite(); e8.graphics.beginFill(0); e8.graphics.drawCircle(50, 50, 30); e8.graphics.endFill(); e8.blendMode = BlendMode.ERASE; h8.addChild(e8); s8.addChild(h8);
// 9: scrollRect
var s9:Sprite = cell(); art(s9); s9.scrollRect = new Rectangle(20, 20, 60, 60);
// 10: scrollRect + 拡大
var s10:Sprite = cell(); art(s10); s10.scrollRect = new Rectangle(10, 0, 50, 90); s10.scaleX = 1.5; s10.scaleY = 0.8;
// 11: scale9Grid（拡大）
var s11:Sprite = cell(); var g11:Graphics = s11.graphics; g11.lineStyle(6, 0x000000); g11.beginFill(0x88cc88); g11.drawRoundRect(0, 0, 40, 40, 20); g11.endFill(); s11.scale9Grid = new Rectangle(12, 12, 16, 16); s11.width = 100; s11.height = 70;
// 12: scale9Grid なしで同じ拡大
var s12:Sprite = cell(); var g12:Graphics = s12.graphics; g12.lineStyle(6, 0x000000); g12.beginFill(0x88cc88); g12.drawRoundRect(0, 0, 40, 40, 20); g12.endFill(); s12.width = 100; s12.height = 70;
// 13: cacheAsBitmap + opaqueBackground
var s13:Sprite = cell(); art(s13); s13.cacheAsBitmap = true; s13.opaqueBackground = 0xccffcc;
// 14: mask に別の mask（ネスト）と、掛ける側が回転
var s14:Sprite = cell(); art(s14); s14.rotation = 10; var m14:Sprite = new Sprite(); m14.graphics.beginFill(0); m14.graphics.drawRect(10, 10, 50, 50); m14.graphics.endFill(); s14.parent.addChild(m14); m14.x = s14.x; m14.y = s14.y; s14.mask = m14;
trace("done");
