// NetStream の一時停止、位置の変更、停止と、見つからないファイル（時刻そのものは実機でも揺れるので、揺れない形で trace する）
// video: 20 name vid depth 5 size 64x48 at 10,10
var frame = 0;
var step = 0;
var held = -1;
var nc = new NetConnection();
nc.connect(null);
var ns = new NetStream(nc);
vid.attachVideo(ns);
ns.onMetaData = function(info) {};
ns.onStatus = function(info) {
  if (info.code.indexOf("NetStream.Buffer.") == 0) return;
  trace("stream " + info.code + " " + info.level + " step " + step);
  if (info.code == "NetStream.Play.Start" && step == 0) { ns.pause(true); held = ns.time; step = 1; frame = 0; }
  if (info.code == "NetStream.Seek.Notify" && step == 1) { trace(" after seek " + Math.round(ns.time * 1000) / 1000); ns.pause(false); step = 2; }
  if (info.code == "NetStream.Play.Stop" && step == 2) {
    trace(" at stop " + Math.round(ns.time * 100) / 100 + " " + vid.width + " " + vid.height);
    ns.close();
    trace(" closed " + ns.time + " " + ns.bytesLoaded + " " + vid.width + " " + vid.height);
    vid.clear();
    vid.attachVideo(null);
    step = 3;
    var missing = new NetStream(nc);
    missing.onStatus = function(info2) { trace("missing " + info2.code + " " + info2.level + " " + missing.time + " " + missing.bytesTotal); };
    missing.play("no-such-file.flv");
  }
};
ns.play("../../tools/assets/video-h263.flv");
onEnterFrame = function() {
  frame++;
  if (step == 1 && frame == 4) { trace("paused " + (ns.time == held) + " " + (held < 0.3)); ns.seek(0.4); }
};
