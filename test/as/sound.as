// Sound オブジェクト: 音量・パン・変換、attachSound、start / stop、鳴り終わりの通知
// sound: 9 export beep seconds 0.3
// sprite: 1 name mc depth 1
// frames: 24
var s = new Sound();
function tf(x) { var t = x.getTransform(); return "ll=" + t.ll + " lr=" + t.lr + " rl=" + t.rl + " rr=" + t.rr; }
trace("typeof " + typeof s + " " + (s instanceof Sound) + " vol=" + s.getVolume() + " pan=" + s.getPan() + " duration=" + s.duration + " position=" + s.position + " " + tf(s));
trace("attach returns " + s.attachSound("beep") + " duration=" + s.duration + " position=" + s.position);
var bad = new Sound(); bad.attachSound("nothing"); trace("bad attach duration=" + bad.duration + " position=" + bad.position + " start=" + bad.start());
s.setVolume(50); trace("vol 50 -> " + s.getVolume() + " " + tf(s));
s.setVolume(150); trace("vol 150 -> " + s.getVolume() + " " + tf(s));
s.setVolume(-10); trace("vol -10 -> " + s.getVolume() + " " + tf(s));
s.setVolume("abc"); trace("vol abc -> " + s.getVolume());
s.setVolume(100);
s.setPan(-100); trace("pan -100 -> " + s.getPan() + " " + tf(s));
s.setPan(40); trace("pan 40 -> " + s.getPan() + " " + tf(s));
s.setPan(200); trace("pan 200 -> " + s.getPan() + " " + tf(s));
s.setPan(0); trace("pan 0 -> " + s.getPan() + " " + tf(s));
s.setTransform({ll: 10, lr: 20, rl: 30, rr: 40}); trace("setTransform -> vol=" + s.getVolume() + " pan=" + s.getPan() + " " + tf(s));
s.setTransform({ll: 100}); trace("partial -> " + tf(s));
s.setVolume(100); s.setPan(0); trace("reset -> " + tf(s));
var other = new Sound(); other.setVolume(20);
trace("two global Sound objects share the volume: " + s.getVolume() + " " + other.getVolume());
var onClip = new Sound(mc); trace("clip sound vol=" + onClip.getVolume() + " duration=" + onClip.duration);
onClip.setVolume(30); trace("clip 30 -> global " + s.getVolume() + " clip " + onClip.getVolume() + " another on same clip " + new Sound(mc).getVolume() + " by name " + new Sound("mc").getVolume());
other.setVolume(100);
var done = 0;
s.onSoundComplete = function() { done++; trace("complete " + done + " at end=" + (this.position == this.duration)); };
trace("start returns " + s.start() + " position=" + s.position + " stop returns " + s.stop());
s.start();
var loader = new Sound();
loader.onLoad = function(ok) { trace("onLoad " + ok); };
trace("loadSound returns " + loader.loadSound("no-such-file.mp3", false) + " bytes=" + loader.getBytesLoaded() + "/" + loader.getBytesTotal());
//// frame 10
trace("frame 10 done=" + done + " position=" + s.position);
s.start(0.1, 2);
//// frame 12
s.stop(); trace("frame 12 stopped done=" + done);
s.start(0, 1); s.stop("beep"); s.start(0.2); stopAllSounds();
onClip.attachSound("beep"); onClip.start();
//// frame 22
trace("frame 22 done=" + done);
stop();
