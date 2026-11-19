// unverified: 実機のデバッガ版は、読み込みが成功しても open の直後に落ちる（期待値は test/avm2.test.js）
// URLLoader: ローカルのファイル（tools/assets/net-vars.txt）を、文字・変数・バイト列として読む。読み込みはホストの network.load に任せる
addEventListener(Event.ENTER_FRAME, function(e:Event):void { frame++; });
text = new URLLoader();
trace(text.dataFormat, text.data, text.bytesLoaded, text.bytesTotal);
text.addEventListener(Event.OPEN, onEvent); text.addEventListener(ProgressEvent.PROGRESS, onEvent); text.addEventListener(Event.COMPLETE, onEvent);
text.load(new URLRequest("../../tools/assets/net-vars.txt"));
trace("after load", text.data, text.bytesLoaded, text.bytesTotal);
vars = new URLLoader(); vars.dataFormat = URLLoaderDataFormat.VARIABLES;
vars.addEventListener(Event.OPEN, onEvent); vars.addEventListener(ProgressEvent.PROGRESS, onEvent); vars.addEventListener(Event.COMPLETE, onEvent);
vars.load(new URLRequest("../../tools/assets/net-vars.txt"));
binary = new URLLoader(); binary.dataFormat = URLLoaderDataFormat.BINARY;
binary.addEventListener(Event.OPEN, onEvent); binary.addEventListener(ProgressEvent.PROGRESS, onEvent); binary.addEventListener(Event.COMPLETE, onEvent);
binary.load(new URLRequest("../../tools/assets/net-vars.txt"));
//// members
public var kept:Array = [];
public var frame:int = 0;
public var text:URLLoader;
public var vars:URLLoader;
public var binary:URLLoader;
public function onEvent(e:Event):void {
  kept.push(e);
  var l:URLLoader = URLLoader(e.target);
  var label:String = l == text ? "text" : l == vars ? "variables" : "binary";
  var more:String = "";
  if (e.type == ProgressEvent.PROGRESS) more = " " + ProgressEvent(e).bytesLoaded + "/" + ProgressEvent(e).bytesTotal;
  if (e.type == Event.COMPLETE) {
    more = " " + l.bytesLoaded + "/" + l.bytesTotal + " " + typeof l.data + " " + getQualifiedClassName(l.data);
    if (l == text) more += " [" + l.data + "]";
    if (l == vars) more += " name=" + l.data.name + " n=" + l.data.n + " " + typeof l.data.n + " msg=[" + l.data.msg + "]";
    if (l == binary) more += " length=" + l.data.length + " position=" + l.data.position + " [" + l.data.readUTFBytes(4) + "]";
  }
  trace(label, e.type, frame > 0, e.bubbles + more);
}
