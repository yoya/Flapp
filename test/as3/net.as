// LoaderInfo、URLLoader、Loader（読み込みは失敗する）、URLVariables、ApplicationDomain、定数のクラス
var frame:int = 0; addEventListener(Event.ENTER_FRAME, function(e:Event):void { frame++; });
var info:LoaderInfo = loaderInfo; var self:Object = this;
// 読み込みが済む前は、読めない項目がある。項目ごとに、値か、誤りの番号を並べる。
var peek:Function = function():String {
  var out:Array = [];
  for each (var name:String in ["width", "height", "frameRate", "swfVersion", "actionScriptVersion", "contentType", "sameDomain", "loader", "bytesLoaded", "bytesTotal", "content", "url", "loaderURL", "parameters", "applicationDomain", "childAllowsParent", "parentAllowsChild", "sharedEvents"]) {
    try { var v:* = info[name]; out.push(name + "=" + (name == "bytesLoaded" || name == "bytesTotal" ? v > 0 : name == "url" || name == "loaderURL" ? typeof v : v === self ? "this" : v)); } catch (e:Error) { out.push(name + "=E" + e.errorID); }
  }
  return out.join(" ");
};
trace(info, info is EventDispatcher, info == root.loaderInfo, stage.loaderInfo == info, new Sprite().loaderInfo, info.parameters === info.parameters, info.bytesLoaded == info.bytesTotal); trace(peek());
var note:Function = function(e:Event):void { kept.push(e); trace("loaderInfo", e.type, e.target == info, e.bubbles, frame, e is ProgressEvent ? ProgressEvent(e).bytesLoaded == info.bytesTotal : ""); trace(peek()); };
info.addEventListener(Event.INIT, note); info.addEventListener(Event.COMPLETE, note); info.addEventListener(Event.OPEN, note); info.addEventListener(Event.UNLOAD, note); info.addEventListener(ProgressEvent.PROGRESS, note);
addEventListener(Event.FRAME_CONSTRUCTED, function(e:Event):void { if (frame < 2) trace("frameConstructed", frame); }); addEventListener(Event.EXIT_FRAME, function(e:Event):void { if (frame < 2) trace("exitFrame", frame); }); addEventListener(Event.ENTER_FRAME, function(e:Event):void { if (frame < 3) trace("enterFrame", frame); });
var loader:URLLoader = new URLLoader(); trace(loader, loader.data, loader.dataFormat, loader.bytesLoaded, loader.bytesTotal, loader is EventDispatcher);
var ld:Loader = new Loader();
trace(ld, ld is DisplayObjectContainer, ld.content, ld.contentLoaderInfo, ld.contentLoaderInfo === ld.contentLoaderInfo, ld.numChildren, ld.contentLoaderInfo.loader == ld, ld.contentLoaderInfo.url, ld.contentLoaderInfo.content, ld.contentLoaderInfo.bytesLoaded, ld.contentLoaderInfo.bytesTotal, ld.contentLoaderInfo.contentType);
addChild(ld); trace(numChildren, ld.parent == this, ld.width, ld.height);
try { ld.contentLoaderInfo.width; } catch (e0:Error) { trace("Error", e0.errorID); }
try { loader.load(null); } catch (e1:TypeError) { trace("TypeError", e1.errorID); }
try { ld.load(null); } catch (e2:TypeError) { trace("TypeError", e2.errorID); }
trace("-- URLVariables");
var v:URLVariables = new URLVariables("a=1"); trace(v.a, v.toString(), v is Object, new URLVariables().toString() == "", new URLVariables("x=a%20b+c&x=2").x, new URLVariables("x=a%20b+c&x=2").x is Array, new URLVariables("k=%E6%97%A5").k, new URLVariables("e=").e == "");
v.decode("b=two"); trace(v.b, v.a); var w:URLVariables = new URLVariables(); w.name = "a b&c=d/é"; trace(w.toString()); w = new URLVariables(); w.list = [1, 2]; trace(w.toString());
try { new URLVariables("novalue"); } catch (e3:Error) { trace("Error", e3.errorID); }
trace("-- system");
trace(ApplicationDomain.currentDomain, ApplicationDomain.currentDomain === ApplicationDomain.currentDomain, ApplicationDomain.currentDomain.hasDefinition("flash.display.Sprite"), ApplicationDomain.currentDomain.hasDefinition("flash.display::Sprite"), ApplicationDomain.currentDomain.hasDefinition("Main"), ApplicationDomain.currentDomain.hasDefinition("Nope"), ApplicationDomain.currentDomain.getDefinition("Main") == Main, ApplicationDomain.currentDomain.getDefinition("flash.display.Sprite") == Sprite, info.applicationDomain == ApplicationDomain.currentDomain, ApplicationDomain.currentDomain.parentDomain);
try { ApplicationDomain.currentDomain.getDefinition("Nope"); } catch (e4:ReferenceError) { trace("ReferenceError", e4.errorID); }
trace(Keyboard.ENTER, Keyboard.SPACE, Keyboard.LEFT, Keyboard.UP, Keyboard.RIGHT, Keyboard.DOWN, Keyboard.ESCAPE, Keyboard.SHIFT, Keyboard.CONTROL, Keyboard.BACKSPACE, Keyboard.TAB, Keyboard.DELETE, Keyboard.F1, Keyboard.F12, Keyboard.A, Keyboard.Z, Keyboard.NUMBER_0, Keyboard.NUMPAD_9, Keyboard.HOME, Keyboard.END, Keyboard.PAGE_UP, Keyboard.PAGE_DOWN, Keyboard.INSERT, Keyboard.CAPS_LOCK);
trace(URLRequestMethod.GET, URLRequestMethod.POST, URLLoaderDataFormat.TEXT, URLLoaderDataFormat.BINARY, URLLoaderDataFormat.VARIABLES, MouseCursor.AUTO, MouseCursor.HAND, Mouse.cursor, typeof Capabilities.version, Capabilities.version.split(" ").length, Capabilities.version.split(",").length, Capabilities.playerType, typeof Capabilities.os, Capabilities.hasAudio, typeof Capabilities.screenResolutionX, ExternalInterface.available, System.useCodePage, typeof System.totalMemory);
var request:URLRequest = new URLRequest("page.html"); request.method = URLRequestMethod.POST; request.data = v; trace(request.url, request.method, request.data == v, new URLRequest().url, new URLRequest().method, new URLRequest().data, new URLRequestHeader("a", "b").name, new URLRequestHeader().value == "");
//// members
public var kept:Array = [];
