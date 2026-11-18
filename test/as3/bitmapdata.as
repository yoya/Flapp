// BitmapData と Bitmap（画素の操作。表示オブジェクトの描き込みは比べない）
var hex:Function = function(v:uint):String { return v.toString(16); };
var dump:Function = function(b:BitmapData):String { var rows:Array = []; for (var y:int = 0; y < b.height; y++) { var row:Array = []; for (var x:int = 0; x < b.width; x++) row.push(hex(b.getPixel32(x, y))); rows.push(row.join(" ")); } return rows.join(" / "); };
var bd:BitmapData = new BitmapData(4, 3);
trace(bd, bd.width, bd.height, bd.transparent, bd.rect, hex(bd.getPixel32(0, 0)), hex(bd.getPixel(0, 0)), bd.getPixel32(4, 0), bd.getPixel(-1, 0), getQualifiedClassName(bd));
var op:BitmapData = new BitmapData(2, 2, false, 0x80123456); trace(op.transparent, hex(op.getPixel32(0, 0)), hex(op.getPixel(1, 1))); op.setPixel32(0, 0, 0x00ff0000); op.setPixel(1, 0, 0xff00ff00); trace(dump(op));
var tr:BitmapData = new BitmapData(2, 2, true, 0); trace(dump(tr)); tr.setPixel32(0, 0, 0xff112233); tr.setPixel32(1, 0, 0x80ff8040); tr.setPixel(0, 1, 0x445566); tr.setPixel(1, 0, 0x102030); tr.setPixel32(1, 1, 0x00ffffff); trace(dump(tr));
// アルファを掛けた値で持たれるので、半透明の画素は書いた色と違う色が読める
var alphas:Array = [1, 2, 3, 64, 127, 128, 200, 254]; var values:Array = [0, 1, 2, 100, 127, 128, 200, 254, 255]; var pm:BitmapData = new BitmapData(1, 1, true, 0); var seen:Array = [];
for each (var a:int in alphas) { var row:Array = []; for each (var v:int in values) { pm.setPixel32(0, 0, (a << 24) | (v << 16) | (v << 8) | v); row.push(pm.getPixel32(0, 0) & 0xff); } seen.push(a + ":" + row.join(",")); } trace(seen.join(" "));
trace("-- rects");
bd.fillRect(new Rectangle(1, 1, 2, 1), 0xffff0000); bd.fillRect(new Rectangle(3, 2, 10, 10), 0x8000ff00); bd.fillRect(new Rectangle(-5, -5, 6, 6), 0xff0000ff); trace(dump(bd));
var copy:BitmapData = bd.clone(); copy.setPixel32(0, 0, 0xff000000); trace(hex(bd.getPixel32(0, 0)), hex(copy.getPixel32(0, 0)), copy.width, copy.transparent, copy is BitmapData);
var dst:BitmapData = new BitmapData(4, 3, true, 0xff808080); dst.copyPixels(bd, new Rectangle(0, 0, 2, 2), new Point(2, 1)); trace(dump(dst));
dst.copyPixels(bd, new Rectangle(2, 1, 5, 5), new Point(-1, -1)); trace(dump(dst));
var half:BitmapData = new BitmapData(2, 1, true, 0x80ff0000); var base:BitmapData = new BitmapData(2, 1, true, 0xff0000ff); base.copyPixels(half, half.rect, new Point(0, 0), null, null, true); trace(dump(base)); base.copyPixels(half, half.rect, new Point(0, 0)); trace(dump(base));
var faint:BitmapData = new BitmapData(2, 1, true, 0x40ffffff); faint.copyPixels(half, half.rect, new Point(1, 0), null, null, true); trace(dump(faint)); var solid:BitmapData = new BitmapData(2, 1, false, 0x0000ff); solid.copyPixels(half, half.rect, new Point(0, 0)); trace(dump(solid)); solid.fillRect(solid.rect, 0x0000ff); solid.copyPixels(half, half.rect, new Point(1, 0), null, null, true); trace(dump(solid));
trace("-- operations");
var ch:BitmapData = new BitmapData(2, 1, true, 0xff000000); ch.copyChannel(bd, new Rectangle(1, 1, 2, 1), new Point(0, 0), BitmapDataChannel.RED, BitmapDataChannel.BLUE); trace(dump(ch)); ch.copyChannel(bd, bd.rect, new Point(0, 0), BitmapDataChannel.BLUE, BitmapDataChannel.ALPHA); trace(dump(ch));
var ct:BitmapData = new BitmapData(2, 1, true, 0xff406080); ct.colorTransform(new Rectangle(0, 0, 1, 1), new ColorTransform(2, 0.5, 1, 1, 10, 0, -200, 0)); trace(dump(ct)); ct.colorTransform(ct.rect, new ColorTransform(1, 1, 1, 0.5)); trace(dump(ct));
var ff:BitmapData = new BitmapData(4, 3, false, 0xffffff); ff.fillRect(new Rectangle(1, 0, 1, 3), 0); ff.floodFill(0, 0, 0xff0000); trace(dump(ff)); ff.floodFill(3, 2, 0x00ff00); ff.floodFill(1, 1, 0x0000ff); ff.floodFill(9, 9, 0x123456); trace(dump(ff));
ff.scroll(1, 0); trace(dump(ff)); ff.scroll(-2, 1); trace(dump(ff)); ff.scroll(0, -5); trace(dump(ff));
trace(bd.getColorBoundsRect(0xffffffff, 0xffff0000), bd.getColorBoundsRect(0xffffffff, 0xffffffff, false), bd.getColorBoundsRect(0xff000000, 0x80000000), bd.getColorBoundsRect(0xffffffff, 0x12345678), bd.getColorBoundsRect(0x00ff0000, 0x00ff0000));
var hit:BitmapData = new BitmapData(3, 3, true, 0); hit.setPixel32(1, 1, 0xff000000); hit.setPixel32(2, 2, 0x40000000);
trace(hit.hitTest(new Point(0, 0), 0xff, new Point(1, 1)), hit.hitTest(new Point(0, 0), 0xff, new Point(2, 2)), hit.hitTest(new Point(0, 0), 0x40, new Point(2, 2)), hit.hitTest(new Point(10, 10), 0xff, new Point(11, 11)), hit.hitTest(new Point(0, 0), 0xff, new Rectangle(0, 0, 1, 1)), hit.hitTest(new Point(0, 0), 0xff, new Rectangle(0, 0, 2, 2)), hit.hitTest(new Point(0, 0), 0xff, hit, new Point(1, 1), 0x40), hit.hitTest(new Point(0, 0), 0xff, hit, new Point(1, 0), 0x40));
var hits:Array = []; for each (var limit:int in [0, 1, 0x3f, 0x40, 0x41, 0xfe, 0xff, 0x100]) hits.push(limit + ":" + [hit.hitTest(new Point(0, 0), limit, new Point(1, 1)), hit.hitTest(new Point(0, 0), limit, new Point(2, 2)), hit.hitTest(new Point(0, 0), limit, new Point(0, 0)), hit.hitTest(new Point(0, 0), limit, new Rectangle(2, 2, 1, 1)), hit.hitTest(new Point(0, 0), limit, new Rectangle(0, 0, 1, 1))].join(",")); trace(hits.join(" "));
trace(hit.hitTest(new Point(0, 0), 1, hit, new Point(0, 0), 1), hit.hitTest(new Point(0, 0), 1, hit, new Point(1, 1), 1), hit.hitTest(new Point(0, 0), 1, hit, new Point(-1, -1), 1), hit.hitTest(new Point(0, 0), 0x41, hit, new Point(1, 1), 1), hit.hitTest(new Point(0, 0), 1, hit, new Point(1, 1), 0x41), hit.hitTest(new Point(5, 5), 1, hit, new Point(6, 6), 1), hit.hitTest(new Point(0, 0), 1, hit, new Point(1, 0), 1), hit.hitTest(new Point(0, 0), 1, new Point(1.5, 1.5)), hit.hitTest(new Point(0, 0), 1, new Rectangle(1.5, 1.5, 0.4, 0.4)));
var vec:Vector.<uint> = bd.getVector(new Rectangle(1, 1, 2, 2)); trace(vec.length, hex(vec[0]), hex(vec[3]), vec is Vector.<uint>); vec[0] = 0xff00ffff; bd.setVector(new Rectangle(0, 0, 2, 2), vec); trace(dump(bd));
var bytes:ByteArray = bd.getPixels(new Rectangle(0, 0, 2, 1)); trace(bytes.length, bytes.position); bytes.position = 0; trace(hex(bytes.readUnsignedInt()), hex(bytes.readUnsignedInt())); bytes.position = 0; bd.setPixels(new Rectangle(2, 2, 2, 1), bytes); trace(dump(bd));
trace("-- bitmap data to bitmap data");
var small:BitmapData = new BitmapData(2, 2, true, 0); small.setPixel32(0, 0, 0xffff0000); small.setPixel32(1, 0, 0xff00ff00); small.setPixel32(0, 1, 0xff0000ff); small.setPixel32(1, 1, 0x80ffffff);
var canvas:BitmapData = new BitmapData(4, 4, true, 0xff000000); canvas.draw(small); trace(dump(canvas)); canvas.draw(small, new Matrix(2, 0, 0, 2, 0, 0)); trace(dump(canvas));
canvas.fillRect(canvas.rect, 0xff000000); canvas.draw(small, new Matrix(1, 0, 0, 1, 2, 1), new ColorTransform(0.5, 1, 1, 1, 0, 0, 0, 0), null, new Rectangle(2, 1, 1, 2)); trace(dump(canvas));
trace("-- errors");
for each (var size:Array in [[0, 1], [1, 0], [-1, 5], [8192, 1], [1, 8192], [8191, 2048]]) { try { var big:BitmapData = new BitmapData(size[0], size[1]); trace(size, "ok", big.width); big.dispose(); } catch (e1:ArgumentError) { trace(size, "ArgumentError", e1.errorID); } }
copy.dispose(); try { copy.width; } catch (e2:ArgumentError) { trace("ArgumentError", e2.errorID); } try { copy.getPixel(0, 0); } catch (e3:ArgumentError) { trace("ArgumentError", e3.errorID); } copy.dispose();
try { bd.fillRect(null, 0); } catch (e4:TypeError) { trace("TypeError", e4.errorID); }
try { bd.copyPixels(null, bd.rect, new Point()); } catch (e5:TypeError) { trace("TypeError", e5.errorID); }
try { bd.copyPixels(copy, bd.rect, new Point()); } catch (e6:ArgumentError) { trace("ArgumentError", e6.errorID); }
trace("-- Bitmap");
var bmp:Bitmap = new Bitmap(bd); bmp.x = 10; bmp.y = 20; addChild(bmp);
trace(bmp, bmp is DisplayObject, bmp is InteractiveObject, bmp.bitmapData == bd, bmp.width, bmp.height, bmp.pixelSnapping, bmp.smoothing, bmp.getBounds(this), bmp.hitTestPoint(11, 21), bmp.hitTestPoint(15, 21), getQualifiedClassName(bmp), width, height);
bmp.scaleX = 2; trace(bmp.width, bmp.getBounds(this)); bmp.bitmapData = small; trace(bmp.width, bmp.height); bmp.bitmapData = null; trace(bmp.bitmapData, bmp.width, bmp.getBounds(this)); bmp.smoothing = true; bmp.pixelSnapping = PixelSnapping.NEVER; trace(bmp.smoothing, bmp.pixelSnapping);
var none:Bitmap = new Bitmap(); trace(none.bitmapData, none.width, none.height, new Bitmap(bd, "always", true).smoothing);
