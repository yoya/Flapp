// BitmapData の applyFilter・threshold・merge・paletteMap・compare・generateFilterRect。実機の値を測る
var t:Function = function(name:String, f:Function):void { try { trace(name, f()); } catch (err:Error) { trace(name, "ERR", err.errorID); } };
var hex:Function = function(b:BitmapData, pts:Array):String { var o:Array = []; for each (var p:Array in pts) o.push(b.getPixel32(p[0], p[1]).toString(16)); return o.join(","); };
var src:BitmapData = new BitmapData(8, 8, true, 0);
src.fillRect(new Rectangle(2, 2, 4, 4), 0xffff0000);
src.setPixel32(0, 0, 0x80336699);
t("threshold ==", function():* { var d:BitmapData = new BitmapData(8, 8, true, 0xff000000); var n:uint = d.threshold(src, src.rect, new Point(0, 0), "==", 0xffff0000, 0xff00ff00, 0xffffffff, false); return n + " " + hex(d, [[3, 3], [0, 0], [1, 1]]); });
t("threshold copy", function():* { var d:BitmapData = new BitmapData(8, 8, true, 0xff000000); var n:uint = d.threshold(src, src.rect, new Point(0, 0), "<", 0x80000000, 0xff0000ff, 0xff000000, true); return n + " " + hex(d, [[3, 3], [0, 0], [1, 1]]); });
t("threshold mask", function():* { var d:BitmapData = new BitmapData(8, 8, true, 0xff000000); var n:uint = d.threshold(src, src.rect, new Point(1, 1), ">=", 0x00ff0000, 0xffffff00, 0x00ff0000, false); return n + " " + hex(d, [[4, 4], [1, 1], [2, 2]]); });
t("threshold ops", function():* { var o:Array = []; for each (var op:String in ["<", "<=", ">", ">=", "==", "!="]) { var d:BitmapData = new BitmapData(8, 8, true, 0); o.push(op + d.threshold(src, src.rect, new Point(0, 0), op, 0xffff0000, 0xff00ff00, 0xffffffff, false)); } return o.join(" "); });
t("threshold bad op", function():* { var d:BitmapData = new BitmapData(8, 8, true, 0); return d.threshold(src, src.rect, new Point(0, 0), "xx", 0, 0, 0xffffffff, false); });
t("merge", function():* { var d:BitmapData = new BitmapData(8, 8, true, 0xff0000ff); d.merge(src, src.rect, new Point(0, 0), 128, 64, 256, 256); return hex(d, [[3, 3], [0, 0], [1, 1]]); });
t("paletteMap", function():* { var d:BitmapData = new BitmapData(8, 8, true, 0); var red:Array = []; for (var i:int = 0; i < 256; i++) red.push(i == 255 ? 0x0000ff00 : i == 0 ? 0x00000011 : 0); d.paletteMap(src, src.rect, new Point(0, 0), red, null, null, null); return hex(d, [[3, 3], [0, 0], [1, 1]]); });
t("compare same", function():* { return src.compare(src.clone()); });
t("compare size", function():* { return src.compare(new BitmapData(4, 4)); });
t("compare diff", function():* { var b:BitmapData = src.clone(); b.setPixel32(3, 3, 0xff00ff00); var r:Object = src.compare(b); return r is BitmapData ? hex(r as BitmapData, [[3, 3], [2, 2]]) + " " + (r as BitmapData).transparent : r; });
t("compare alpha", function():* { var b:BitmapData = src.clone(); b.setPixel32(3, 3, 0x80ff0000); var r:Object = src.compare(b); return r is BitmapData ? hex(r as BitmapData, [[3, 3]]) : r; });
t("generateFilterRect blur", function():* { return src.generateFilterRect(src.rect, new BlurFilter(4, 4, 1)); });
t("generateFilterRect cm", function():* { return src.generateFilterRect(src.rect, new ColorMatrixFilter()); });
t("applyFilter cm", function():* { var d:BitmapData = new BitmapData(8, 8, true, 0); d.applyFilter(src, src.rect, new Point(0, 0), new ColorMatrixFilter([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0])); return hex(d, [[3, 3], [0, 0]]); });
t("applyFilter blur", function():* { var d:BitmapData = new BitmapData(8, 8, true, 0); d.applyFilter(src, src.rect, new Point(0, 0), new BlurFilter(2, 2, 1)); return hex(d, [[3, 3], [2, 2], [0, 3]]); }); // 縁の外の半透明の値は、ぼかしの近似で少し違う
t("applyFilter offset", function():* { var d:BitmapData = new BitmapData(8, 8, true, 0); d.applyFilter(src, new Rectangle(2, 2, 4, 4), new Point(4, 4), new ColorMatrixFilter()); return hex(d, [[4, 4], [7, 7], [3, 3]]); });
t("applyFilter glow", function():* { var d:BitmapData = new BitmapData(8, 8, true, 0); d.applyFilter(src, src.rect, new Point(0, 0), new GlowFilter(0x0000ff, 1, 2, 2, 2, 1)); return hex(d, [[3, 3], [0, 3]]); });
t("applyFilter null", function():* { var d:BitmapData = new BitmapData(8, 8, true, 0); d.applyFilter(src, src.rect, new Point(0, 0), null); return "ok"; });
