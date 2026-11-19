// unverified: 実機のデバッガ版は、読み込んだ子のムービーの addedToStage の直後に落ちる（期待値は test/avm2.test.js）
// Loader: ローカルの画像（tools/assets/pic.png、32×24 px）と、AS3 の SWF（test/fixtures/as3-loadchild.swf）を読み込む
addEventListener(Event.ENTER_FRAME, function(e:Event):void {
  frame++;
  if (frame == 5) {
    image.contentLoaderInfo.addEventListener(Event.UNLOAD, function(e:Event):void { kept.push(e); trace("image unload", image.content, image.numChildren); });
    image.unload();
    trace("after unload", image.content, image.numChildren, image.contentLoaderInfo.url);
    // loadBytes: URLLoader で読んだバイト列（GIF）を渡す。
    var bytes:URLLoader = new URLLoader();
    bytes.dataFormat = URLLoaderDataFormat.BINARY;
    bytes.addEventListener(Event.COMPLETE, function(e:Event):void { kept.push(e); image.loadBytes(bytes.data); trace("loadBytes called", image.content); });
    bytes.load(new URLRequest("../../tools/assets/pic.gif"));
  }
});
image = new Loader();
image.x = 10;
addChild(image);
watch(image, "image");
image.load(new URLRequest("../../tools/assets/pic.png"));
trace("after load", image.content, image.numChildren, image.contentLoaderInfo.bytesTotal, image.contentLoaderInfo.url);
movie = new Loader();
movie.y = 60;
addChild(movie);
watch(movie, "movie");
movie.load(new URLRequest("as3-loadchild.swf"));
//// members
public var kept:Array = [];
public var frame:int = 0;
public var image:Loader;
public var movie:Loader;
public function watch(l:Loader, label:String):void {
  for each (var type:String in [Event.OPEN, Event.INIT, Event.COMPLETE, IOErrorEvent.IO_ERROR]) {
    l.contentLoaderInfo.addEventListener(type, function(e:Event):void { kept.push(e); report(l, label, e.type); });
  }
  l.contentLoaderInfo.addEventListener(ProgressEvent.PROGRESS, function(e:ProgressEvent):void { kept.push(e); if (e.bytesLoaded == e.bytesTotal) report(l, label, e.type); });
}
public function report(l:Loader, label:String, type:String):void {
  var info:LoaderInfo = l.contentLoaderInfo;
  var more:String = "";
  if (type == Event.INIT || type == Event.COMPLETE) {
    more = " content=" + getQualifiedClassName(l.content) + " children=" + l.numChildren + " same=" + (l.content == info.content) + " size=" + info.width + "x" + info.height
      + " type=" + info.contentType + " bytes=" + (info.bytesLoaded == info.bytesTotal) + " loader=" + (info.loader == l)
      + " content size=" + l.content.width + "x" + l.content.height + " parent=" + (l.content.parent == l);
    if (info.contentType == "application/x-shockwave-flash") more += " swf=" + info.swfVersion + " as=" + info.actionScriptVersion + " rate=" + info.frameRate;
    else try { trace(info.swfVersion); } catch (e:Error) { more += " swfVersion error " + e.errorID; }
    if (l.content is MovieClip) more += " frames=" + MovieClip(l.content).currentFrame + "/" + MovieClip(l.content).totalFrames + " root=" + (l.content.root == l.content) + " childVar=" + Object(l.content).childVar;
  }
  trace(label, type, frame > 0, more);
}
