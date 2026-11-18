// NetConnection、NetStream、Video: FLV ファイル（tools/assets/video-h263.flv、64×48 px、8 フレーム）を再生する
var frame:int = 0; addEventListener(Event.ENTER_FRAME, function(e:Event):void { frame++; });
var nc:NetConnection = new NetConnection();
trace(nc, nc.connected, nc.uri, nc is EventDispatcher);
try { new NetStream(nc); } catch (e1:Error) { trace("Error", e1.errorID); }
nc.addEventListener(NetStatusEvent.NET_STATUS, function(e:NetStatusEvent):void { kept.push(e); trace("connection", e.info.code, e.info.level, nc.connected, e.target == nc, e.bubbles, e.type, frame > 0); });
nc.connect(null); trace(nc.connected, nc.uri);
var ns:NetStream = new NetStream(nc);
trace(ns, ns.time, ns.bytesLoaded, ns.bytesTotal, ns.bufferLength, ns.bufferTime, ns.client == ns, ns.soundTransform.volume, ns is EventDispatcher);
var video:Video = new Video();
trace(video, video.width, video.height, video.videoWidth, video.videoHeight, video.smoothing, video.deblocking, video is DisplayObject, video is InteractiveObject, getQualifiedClassName(video), new Video(64, 48).width, new Video(64, 48).height, video.getBounds(video));
video.attachNetStream(ns); addChild(video); trace(video.parent == this, numChildren, video.name.indexOf("instance") == 0);
var client:Object = {}; client.onMetaData = function(info:Object):void { trace("onMetaData", info.duration, info.width, info.height, info.framerate, info.videocodecid, typeof info); };
ns.client = client; trace(ns.client == client);
ns.addEventListener(AsyncErrorEvent.ASYNC_ERROR, function(e:AsyncErrorEvent):void { kept.push(e); trace("asyncError", e.error.errorID); });
ns.addEventListener(NetStatusEvent.NET_STATUS, function(e:NetStatusEvent):void {
  kept.push(e);
  if (e.info.code.indexOf("NetStream.Buffer.") == 0) return; // バッファの通知は、実機でも毎回同じ並びにはならない
  trace("stream", e.info.code, e.info.level, e.target == ns);
  if (e.info.code == "NetStream.Play.Stop") trace(" at stop", Math.round(ns.time * 100) / 100, video.videoWidth, video.videoHeight, ns.bytesLoaded == ns.bytesTotal, ns.bytesTotal, video.width, video.height);
});
ns.play("../../tools/assets/video-h263.flv");
try { ns.client = null; } catch (e2:TypeError) { trace("TypeError", e2.errorID); }
try { video.attachNetStream(Object(5) as NetStream); trace("attach null ok"); video.attachNetStream(ns); } catch (e3:Error) { trace("Error", e3.errorID); }
//// members
public var kept:Array = [];
