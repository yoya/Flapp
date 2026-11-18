// unverified: 実機のデバッガ版は、読み込みの失敗の通知の途中で落ちる（期待値は test/avm2.test.js）
var frame:int = 0; addEventListener(Event.ENTER_FRAME, function(e:Event):void { frame++; });
var kept:Array = [];
var loader:URLLoader = new URLLoader();
var other:Function = function(e:Event):void { kept.push(e); trace("URLLoader", e.type, frame); };
for each (var t:String in [Event.OPEN, Event.COMPLETE, ProgressEvent.PROGRESS, SecurityErrorEvent.SECURITY_ERROR, HTTPStatusEvent.HTTP_STATUS]) loader.addEventListener(t, other);
var ld:Loader = new Loader(); addChild(ld);
var snd:Sound = new Sound();
loader.addEventListener(IOErrorEvent.IO_ERROR, function(e:IOErrorEvent):void {
  kept.push(e); trace("URLLoader ioError", e.target == loader, e.errorID, e.text, e is ErrorEvent, e is TextEvent, e.bubbles, e.cancelable, loader.data, loader.bytesLoaded, frame);
  ld.load(new URLRequest("missing-file.swf")); snd.load(new URLRequest("http://example.com/missing-file.mp3"));
});
ld.contentLoaderInfo.addEventListener(IOErrorEvent.IO_ERROR, function(e:IOErrorEvent):void { kept.push(e); trace("Loader ioError", e.target == ld.contentLoaderInfo, e.errorID, ld.content, frame); });
snd.addEventListener(IOErrorEvent.IO_ERROR, function(e:IOErrorEvent):void { kept.push(e); trace("Sound ioError", e.target == snd, e.errorID, snd.url, snd.length, frame); });
loader.load(new URLRequest("missing-file.txt"));
var so:SharedObject = SharedObject.getLocal("flapp-test"); so.data.score = 12; so.data.list = [1, 2];
trace(so, so.data.score, SharedObject.getLocal("flapp-test") === so, SharedObject.getLocal("flapp-test").data.list, so.flush(), so.size, SharedObject.getLocal("other").data.score);
so.clear(); trace(so.data.score);
navigateToURL(new URLRequest("http://example.com/page"), "_blank"); sendToURL(new URLRequest("http://example.com/log")); fscommand("fullscreen", "true"); trace(ExternalInterface.call("f", 1));
new URLLoader().load(new URLRequest("unheard.txt"));
