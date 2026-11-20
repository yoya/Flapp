// size: 420x300
// DisplacementMapFilter: プロパティの値と、画面（基準位置、拡大、モード、成分）を測る
var t:Function = function(name:String, f:Function):void { try { trace(name, f()); } catch (e:Error) { trace(name, "ERR", e.errorID); } };
var props:Function = function(d:DisplacementMapFilter):String { return [d.mapBitmap ? d.mapBitmap.width : null, d.mapPoint, d.componentX, d.componentY, d.scaleX, d.scaleY, d.mode, d.color, d.alpha].join("|"); };
t("defaults", function():* { return props(new DisplacementMapFilter()); });
t("values", function():* { return props(new DisplacementMapFilter(new BitmapData(3, 3), new Point(1.5, -2), 3, 8, 1000, -70000, "clamp", 0x123456, 0.3)); });
t("mode bad", function():* { var d:DisplacementMapFilter = new DisplacementMapFilter(); d.mode = "xyz"; return d.mode; });
t("mode null", function():* { var d:DisplacementMapFilter = new DisplacementMapFilter(); d.mode = null; return d.mode; });
t("alpha range", function():* { var d:DisplacementMapFilter = new DisplacementMapFilter(); d.alpha = 3; var a:Number = d.alpha; d.alpha = -1; return [a, d.alpha].join(","); });
t("color", function():* { var d:DisplacementMapFilter = new DisplacementMapFilter(); d.color = 0xff123456; return d.color; });
t("mapPoint copy", function():* { var p:Point = new Point(1, 2); var d:DisplacementMapFilter = new DisplacementMapFilter(null, p); p.x = 9; return [d.mapPoint.x, d.mapPoint === p].join(","); });
t("mapBitmap same", function():* { var b:BitmapData = new BitmapData(2, 2); var d:DisplacementMapFilter = new DisplacementMapFilter(b); return d.mapBitmap === b; });
t("clone", function():* { var d:DisplacementMapFilter = new DisplacementMapFilter(new BitmapData(2, 2), new Point(3, 4), 1, 2, 5, 6, "color", 0xff, 0.5); return props(d.clone() as DisplacementMapFilter); });
t("filters roundtrip", function():* { var s:Sprite = new Sprite(); s.filters = [new DisplacementMapFilter(new BitmapData(2, 2), new Point(3, 4), 1, 2, 5, 6, "ignore", 0xff, 0.5)]; return props(s.filters[0]); });
t("constants", function():* { return [DisplacementMapFilterMode.WRAP, DisplacementMapFilterMode.CLAMP, DisplacementMapFilterMode.IGNORE, DisplacementMapFilterMode.COLOR, BitmapDataChannel.RED, BitmapDataChannel.GREEN, BitmapDataChannel.BLUE, BitmapDataChannel.ALPHA].join(","); });
// 縞模様の対象（縦の縞。x 方向の変位が見える）
var target:Function = function(x:int, y:int, ox:int, oy:int):Sprite {
  var s:Sprite = new Sprite(); s.x = x; s.y = y; addChild(s);
  for (var i:int = 0; i < 10; i++) { s.graphics.beginFill(i % 2 ? 0x0000ff : 0xffcc00); s.graphics.drawRect(ox + i * 8, oy, 8, 60); s.graphics.endFill(); }
  return s;
};
// 地図: 左半分は赤 0x80（変位なし）、右半分は赤 0xff（+）、下 1/3 は緑 0x00
var map:BitmapData = new BitmapData(40, 40, false, 0x808080);
map.fillRect(new Rectangle(20, 0, 20, 40), 0xff8080);
map.fillRect(new Rectangle(0, 27, 40, 13), 0x800080);
var f:Function = function(mode:String, px:Number, py:Number):DisplacementMapFilter { return new DisplacementMapFilter(map, new Point(px, py), BitmapDataChannel.RED, BitmapDataChannel.GREEN, 40, 30, mode); };
target(10, 10, 0, 0).filters = [f("wrap", 10, 10)];
target(110, 10, 0, 0).filters = [f("clamp", 10, 10)];
target(210, 10, 0, 0).filters = [f("ignore", 10, 10)];
var c:DisplacementMapFilter = f("color", 10, 10); c.color = 0x00ff00; c.alpha = 0.5;
target(310, 10, 0, 0).filters = [c];
// 基準: 登録点が中央（-40, -30 から描く）
target(50, 140, -40, -30).filters = [f("clamp", 10, 10)];
// 拡大した物体
var big:Sprite = target(110, 110, 0, 0); big.scaleX = 1.5; big.scaleY = 1.5; big.filters = [f("clamp", 10, 10)];
// 地図より外（mapPoint が大きい）
target(250, 110, 0, 0).filters = [f("clamp", 60, 0)];
// 子を持つ（入れ物にフィルタ）
var holder:Sprite = new Sprite(); holder.x = 330; holder.y = 110; addChild(holder);
var inner:Sprite = target(0, 0, 0, 0); removeChild(inner); inner.x = 5; holder.addChild(inner); holder.filters = [f("clamp", 0, 0)];
// 回転した物体
var rot:Sprite = target(60, 200, 0, 0); rot.rotation = 20; rot.filters = [f("clamp", 10, 10)];
