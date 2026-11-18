// unverified: 時刻に左右される操作（一時停止、位置の変更）と、見つからないファイル（期待値は test/avm2.test.js）
var frame:int = 0; var kept:Array = [];
var nc:NetConnection = new NetConnection(); nc.connect(null);
var ns:NetStream = new NetStream(nc); ns.client = { onMetaData: function(info:Object):void {} };
var video:Video = new Video(64, 48); video.attachNetStream(ns); addChild(video);
var at:Function = function():Number { return Math.round(ns.time * 1000); };
ns.addEventListener(NetStatusEvent.NET_STATUS, function(e:NetStatusEvent):void { kept.push(e); trace(frame, e.info.code, at()); });
ns.play("../../tools/assets/video-h263.flv");
addEventListener(Event.ENTER_FRAME, function(e:Event):void {
  frame++;
  if (frame == 3) { ns.pause(); trace("paused", at(), video.videoWidth, video.videoHeight); }
  if (frame == 6) { trace("still", at()); ns.resume(); }
  if (frame == 8) { ns.seek(0.4); trace("seek", at()); }
  if (frame == 9) { ns.togglePause(); trace("toggled", at()); ns.togglePause(); }
  if (frame == 20) {
    var missing:NetStream = new NetStream(nc);
    missing.addEventListener(NetStatusEvent.NET_STATUS, function(e2:NetStatusEvent):void { kept.push(e2); trace(frame, "missing", e2.info.code, e2.info.level); });
    missing.play("no-such-file.flv");
    var server:NetConnection = new NetConnection();
    server.addEventListener(NetStatusEvent.NET_STATUS, function(e3:NetStatusEvent):void { kept.push(e3); trace(frame, "server", e3.info.code, e3.info.level, server.connected); });
    server.connect("rtmp://example.com/app");
    var silent:NetStream = new NetStream(nc); silent.play("unheard.flv");
  }
});
