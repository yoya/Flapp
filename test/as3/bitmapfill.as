// size: 400x300
// 描画 API のビットマップの塗り・線、3 次曲線、drawPath、drawGraphicsData。実機の値と画面を測る
var t:Function = function(name:String, f:Function):void { try { trace(name, f()); } catch (e:Error) { trace(name, "ERR", e.errorID); } };
// 4x4 の市松模様（赤・青）と、縁の色が分かる 3x3
var bmp:BitmapData = new BitmapData(4, 4, false, 0xff0000);
bmp.fillRect(new Rectangle(0, 0, 2, 2), 0x0000ff); bmp.fillRect(new Rectangle(2, 2, 2, 2), 0x0000ff);
var small:BitmapData = new BitmapData(3, 3, true, 0x8000ff00);
small.setPixel32(1, 1, 0xffffff00);
var s:Sprite = new Sprite(); addChild(s);
var g:Graphics = s.graphics;
var cell:Function = function(i:int):Point { return new Point(10 + (i % 6) * 64, 10 + int(i / 6) * 64); };
var p:Point;
// 0: 既定（繰り返し、補間なし、行列なし）
p = cell(0); g.beginBitmapFill(bmp); g.drawRect(p.x, p.y, 50, 50); g.endFill();
// 1: 拡大の行列（8 倍）
p = cell(1); var m:Matrix = new Matrix(); m.scale(8, 8); m.translate(p.x, p.y); g.beginBitmapFill(bmp, m); g.drawRect(p.x, p.y, 50, 50); g.endFill();
// 2: 拡大して補間あり
p = cell(2); m = new Matrix(); m.scale(8, 8); m.translate(p.x, p.y); g.beginBitmapFill(bmp, m, true, true); g.drawRect(p.x, p.y, 50, 50); g.endFill();
// 3: 繰り返しなし（範囲の外は縁の色）
p = cell(3); m = new Matrix(); m.scale(5, 5); m.translate(p.x + 10, p.y + 10); g.beginBitmapFill(small, m, false); g.drawRect(p.x, p.y, 50, 50); g.endFill();
// 4: 回転
p = cell(4); m = new Matrix(); m.scale(6, 6); m.rotate(Math.PI / 6); m.translate(p.x + 25, p.y); g.beginBitmapFill(bmp, m); g.drawCircle(p.x + 25, p.y + 25, 24); g.endFill();
// 5: 半透明のビットマップ
p = cell(5); m = new Matrix(); m.scale(10, 10); m.translate(p.x, p.y); g.beginFill(0x000000); g.drawRect(p.x, p.y + 20, 50, 10); g.endFill(); g.beginBitmapFill(small, m); g.drawRect(p.x, p.y, 50, 50); g.endFill();
// 6: 線をビットマップで
p = cell(6); m = new Matrix(); m.scale(4, 4); g.lineStyle(10, 0); g.lineBitmapStyle(bmp, m); g.moveTo(p.x + 5, p.y + 5); g.lineTo(p.x + 45, p.y + 45); g.lineStyle();
// 7: 3 次曲線
p = cell(7); g.lineStyle(2, 0x008000); g.moveTo(p.x, p.y + 50); g.cubicCurveTo(p.x, p.y, p.x + 50, p.y, p.x + 50, p.y + 50); g.lineStyle();
// 8: drawPath（WIDE_MOVE_TO・CURVE_TO・CUBIC_CURVE_TO、nonZero）
p = cell(8);
g.beginFill(0xff8000);
g.drawPath(Vector.<int>([1, 2, 2, 2, 2, 1, 2, 2, 2, 2]), Vector.<Number>([p.x, p.y, p.x + 50, p.y, p.x + 50, p.y + 50, p.x, p.y + 50, p.x, p.y, p.x + 10, p.y + 10, p.x + 40, p.y + 10, p.x + 40, p.y + 40, p.x + 10, p.y + 40, p.x + 10, p.y + 10]), "nonZero");
g.endFill();
p = cell(9);
g.beginFill(0xff8000);
g.drawPath(Vector.<int>([1, 2, 2, 2, 2, 1, 2, 2, 2, 2]), Vector.<Number>([p.x, p.y, p.x + 50, p.y, p.x + 50, p.y + 50, p.x, p.y + 50, p.x, p.y, p.x + 10, p.y + 10, p.x + 40, p.y + 10, p.x + 40, p.y + 40, p.x + 10, p.y + 40, p.x + 10, p.y + 10]), "evenOdd");
g.endFill();
p = cell(10);
g.lineStyle(2, 0x0000ff);
g.drawPath(Vector.<int>([4, 5, 3, 6, 0]), Vector.<Number>([0, 0, p.x, p.y, 0, 0, p.x + 20, p.y, p.x + 50, p.y, p.x + 50, p.y + 20, p.x + 50, p.y + 50, p.x, p.y + 50, p.x + 25, p.y + 25]));
g.lineStyle();
// 11: drawGraphicsData
p = cell(11);
var path:GraphicsPath = new GraphicsPath(Vector.<int>([1, 2, 2, 2]), Vector.<Number>([p.x, p.y, p.x + 50, p.y, p.x + 25, p.y + 50, p.x, p.y]));
g.drawGraphicsData(Vector.<IGraphicsData>([new GraphicsStroke(3, false, "normal", "none", "round", 3, new GraphicsSolidFill(0x800080, 1)), new GraphicsSolidFill(0x00c0c0, 0.5), path, new GraphicsEndFill()]));
// 12: GraphicsBitmapFill
p = cell(12); m = new Matrix(); m.scale(5, 5);
g.drawGraphicsData(Vector.<IGraphicsData>([new GraphicsStroke(NaN), new GraphicsBitmapFill(bmp, m), new GraphicsPath(Vector.<int>([1, 2, 2, 2, 2]), Vector.<Number>([p.x, p.y, p.x + 50, p.y, p.x + 50, p.y + 50, p.x, p.y + 50, p.x, p.y])), new GraphicsEndFill()]));
// 13: 描いたあとでビットマップを変える（塗りに反映されるか）
p = cell(13); var live:BitmapData = new BitmapData(2, 2, false, 0x00ff00); m = new Matrix(); m.scale(25, 25); m.translate(p.x, p.y); g.beginBitmapFill(live, m); g.drawRect(p.x, p.y, 50, 50); g.endFill();
live.setPixel(0, 0, 0x000000);
// 値と誤り
t("null bitmap", function():* { g.beginBitmapFill(null); return "ok"; });
t("disposed", function():* { var d:BitmapData = new BitmapData(2, 2); d.dispose(); g.beginBitmapFill(d); return "ok"; });
t("line null bitmap", function():* { g.lineBitmapStyle(null); return "ok"; });
t("drawPath null", function():* { g.drawPath(null, null); return "ok"; });
t("drawPath short data", function():* { g.drawPath(Vector.<int>([1, 2]), Vector.<Number>([0, 0, 5])); return "ok"; });
t("drawPath bad winding", function():* { g.drawPath(Vector.<int>([1]), Vector.<Number>([0, 0]), "xyz"); return "ok"; });
t("drawPath bad command", function():* { g.drawPath(Vector.<int>([9, 1]), Vector.<Number>([0, 0, 1, 1])); return "ok"; });
t("drawGraphicsData null", function():* { g.drawGraphicsData(null); return "ok"; });
t("GraphicsPath defaults", function():* { var gp:GraphicsPath = new GraphicsPath(); return [gp.commands, gp.data, gp.winding].join("|"); });
t("GraphicsPath methods", function():* { var gp:GraphicsPath = new GraphicsPath(); gp.moveTo(1, 2); gp.lineTo(3, 4); gp.curveTo(5, 6, 7, 8); gp.wideLineTo(9, 10); gp.wideMoveTo(11, 12); gp.cubicCurveTo(1, 2, 3, 4, 5, 6); return [gp.commands, gp.data].join("|"); });
t("GraphicsPath winding", function():* { var gp:GraphicsPath = new GraphicsPath(null, null, "nonZero"); var r:String = gp.winding; try { gp.winding = "bad"; } catch (e:Error) { r += " ERR " + e.errorID; } return r + " " + gp.winding; });
t("GraphicsStroke defaults", function():* { var st:GraphicsStroke = new GraphicsStroke(); return [st.thickness, st.pixelHinting, st.scaleMode, st.caps, st.joints, st.miterLimit, st.fill].join("|"); });
t("GraphicsSolidFill defaults", function():* { var sf:GraphicsSolidFill = new GraphicsSolidFill(); return [sf.color, sf.alpha].join("|"); });
t("GraphicsBitmapFill defaults", function():* { var bf:GraphicsBitmapFill = new GraphicsBitmapFill(); return [bf.bitmapData, bf.matrix, bf.repeat, bf.smooth].join("|"); });
t("GraphicsGradientFill defaults", function():* { var gf:GraphicsGradientFill = new GraphicsGradientFill(); return [gf.type, gf.colors, gf.alphas, gf.ratios, gf.matrix, gf.spreadMethod, gf.interpolationMethod, gf.focalPointRatio].join("|"); });
t("constants", function():* { return [GraphicsPathCommand.NO_OP, GraphicsPathCommand.MOVE_TO, GraphicsPathCommand.LINE_TO, GraphicsPathCommand.CURVE_TO, GraphicsPathCommand.WIDE_MOVE_TO, GraphicsPathCommand.WIDE_LINE_TO, GraphicsPathCommand.CUBIC_CURVE_TO, GraphicsPathWinding.EVEN_ODD, GraphicsPathWinding.NON_ZERO].join(","); });
t("readGraphicsData", function():* { var sp:Sprite = new Sprite(); sp.graphics.beginFill(0xff0000); sp.graphics.drawRect(0, 0, 10, 10); var v:Vector.<IGraphicsData> = sp.graphics.readGraphicsData(); var o:Array = []; for each (var d:Object in v) o.push(getQualifiedClassName(d)); return o.join(","); });
t("width", function():* { return [s.width, s.height].join(","); });
