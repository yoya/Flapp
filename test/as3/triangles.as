// size: 320x200
// Graphics.drawTriangles（単色・ビットマップの UV・裏向きの省略）。実機の値と画面を測る（線を引いた状態の drawTriangles は、実機のデバッガ版が落ちる）
var t:Function = function(name:String, f:Function):void { try { trace(name, f()); } catch (err:Error) { trace(name, "ERR", err.errorID); } };
var bmp:BitmapData = new BitmapData(4, 4, false, 0xff0000);
bmp.fillRect(new Rectangle(0, 0, 2, 2), 0x0000ff); bmp.fillRect(new Rectangle(2, 2, 2, 2), 0x0000ff);
var s:Sprite = new Sprite(); addChild(s);
var g:Graphics = s.graphics;
// 1: 単色、添字なし（3 つずつ）
g.beginFill(0x00aa00); g.drawTriangles(Vector.<Number>([10, 10, 60, 10, 10, 60, 70, 20, 70, 70, 20, 70])); g.endFill();
// 2: 添字つきの四角（2 枚）にビットマップを UV で
g.beginBitmapFill(bmp); g.drawTriangles(Vector.<Number>([90, 10, 150, 10, 150, 70, 90, 70]), Vector.<int>([0, 1, 2, 0, 2, 3]), Vector.<Number>([0, 0, 1, 0, 1, 1, 0, 1])); g.endFill();
// 3: ゆがんだ四角にビットマップ（台形）
g.beginBitmapFill(bmp, null, false, true); g.drawTriangles(Vector.<Number>([180, 10, 240, 20, 250, 70, 170, 60]), Vector.<int>([0, 1, 2, 0, 2, 3]), Vector.<Number>([0, 0, 1, 0, 1, 1, 0, 1])); g.endFill();
// 4: 裏向きの省略（同じ 2 枚を、向きを変えて）
g.beginFill(0xff8800); g.drawTriangles(Vector.<Number>([10, 100, 60, 100, 10, 150, 70, 110, 20, 160, 70, 160]), null, null, TriangleCulling.POSITIVE); g.endFill();
g.beginFill(0x8800ff); g.drawTriangles(Vector.<Number>([90, 100, 140, 100, 90, 150, 150, 110, 100, 160, 150, 160]), null, null, TriangleCulling.NEGATIVE); g.endFill();
// 6: uvt（t 付き）
g.beginBitmapFill(bmp); g.drawTriangles(Vector.<Number>([260, 100, 310, 100, 310, 150, 260, 150]), Vector.<int>([0, 1, 2, 0, 2, 3]), Vector.<Number>([0, 0, 1, 1, 0, 1, 1, 1, 0.5, 0, 1, 0.5])); g.endFill();
t("bounds", function():* { return [s.width, s.height].join(","); });
t("bad culling", function():* { g.drawTriangles(Vector.<Number>([0, 0, 1, 0, 0, 1]), null, null, "xx"); return "ok"; });
t("null vertices", function():* { g.drawTriangles(null); return "ok"; });
t("short", function():* { g.drawTriangles(Vector.<Number>([0, 0, 1, 0])); return "ok"; });
t("constants", function():* { return [TriangleCulling.NONE, TriangleCulling.POSITIVE, TriangleCulling.NEGATIVE].join(","); });
