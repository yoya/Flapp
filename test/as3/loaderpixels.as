// unverified: 実機は Loader で 1 枚読むと落ちる。実機の値（PNG・JPEG）は受信サーバから画像を配って測り、ブラウザ（decodeImage）で照合した
// Loader で読んだ画像（PNG・GIF・JPEG）の bitmapData の画素
var kept:Array = [];
var urls:Array = ["pic.png", "pic.gif", "pic.jpg"];
var next:Function = function(i:int):void {
  if (i >= urls.length) return;
  var l:Loader = new Loader(); kept.push(l);
  l.contentLoaderInfo.addEventListener("complete", function(e:Event):void {
    kept.push(e);
    var b:BitmapData = Bitmap(l.content).bitmapData;
    var px:Array = [];
    for each (var p:Array in [[0, 0], [5, 3], [16, 12], [31, 23], [10, 20]]) px.push(b.getPixel32(p[0], p[1]).toString(16));
    trace(urls[i], b.width, b.height, b.transparent, px.join(","));
    next(i + 1);
  });
  l.contentLoaderInfo.addEventListener("ioError", function(e:Event):void { kept.push(e); trace(urls[i], "ioError"); next(i + 1); });
  l.load(new URLRequest(urls[i]));
};
next(0);
