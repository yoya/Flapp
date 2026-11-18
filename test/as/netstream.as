// NetConnection、NetStream、Video: FLV ファイル（tools/assets/video-h263.flv、64×48 px、8 フレーム）を再生する
// video: 20 name vid depth 5 size 64x48 at 10,10
var frame = 0;
onEnterFrame = function() { frame++; };
var nc = new NetConnection();
trace(nc + " " + nc.isConnected + " " + nc.uri + " " + typeof nc.connect + " " + (nc instanceof NetConnection) + " " + typeof NetConnection);
nc.onStatus = function(info) { trace("connection " + info.code + " " + info.level + " " + this.isConnected + " " + (frame > 0)); };
trace(nc.connect(null) + " " + nc.isConnected + " " + nc.uri);
var ns = new NetStream(nc);
trace(ns + " " + ns.time + " " + ns.bytesLoaded + " " + ns.bytesTotal + " " + ns.bufferLength + " " + ns.bufferTime + " " + ns.currentFps + " " + (ns instanceof NetStream) + " " + typeof ns.play);
trace(vid + " " + typeof vid + " " + (vid instanceof Video) + " " + typeof Video + " " + targetPath(vid) + " " + vid._name + " " + vid._parent);
trace(vid._x + " " + vid._y + " " + vid._width + " " + vid._height + " " + vid.width + " " + vid.height + " " + vid.smoothing + " " + vid.deblocking + " " + vid._visible + " " + vid._alpha + " " + vid._xscale + " " + vid._rotation);
vid._x = 20; vid.smoothing = true; vid.deblocking = 2; vid.width = 99;
trace(vid._x + " " + vid.smoothing + " " + vid.deblocking + " " + vid.width + " " + typeof vid.attachVideo + " " + typeof vid.clear);
vid.attachVideo(ns);
ns.onMetaData = function(info) { trace("onMetaData " + info.duration + " " + info.width + " " + info.height + " " + info.framerate + " " + info.videocodecid + " " + typeof info + " " + (this == ns)); };
ns.onStatus = function(info) {
  if (info.code.indexOf("NetStream.Buffer.") == 0) return; // バッファの通知は、実機でも毎回同じ並びにはならない
  trace("stream " + info.code + " " + info.level + " " + (this == ns));
  if (info.code == "NetStream.Play.Stop") trace(" at stop " + Math.round(ns.time * 100) / 100 + " " + vid.width + " " + vid.height + " " + (ns.bytesLoaded == ns.bytesTotal) + " " + ns.bytesTotal + " " + vid._width + " " + vid._height);
};
ns.setBufferTime(0.5);
trace(ns.bufferTime);
ns.play("../../tools/assets/video-h263.flv");
var nc2 = new NetConnection();
var ns2 = new NetStream(nc2);
trace(ns2 + " " + ns2.time + " " + nc2.isConnected);
trace(new NetStream() + " " + new Video());
