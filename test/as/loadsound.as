// Sound.loadSound: ローカルの MP3（tools/assets/tone.mp3、0.3 秒）を、イベント音とストリーミングの両方で読む
var frame = 0;
onEnterFrame = function() {
  frame++;
  if (frame == 10) trace("frame 10: event pos=" + ev.position + " dur=" + ev.duration + " | stream pos=" + (st.position > 0) + " dur=" + st.duration);
  if (frame == 20) { trace("frame 20: start event"); ev.start(); }
};
var ev = new Sound();
ev.onLoad = function(ok) { trace("event onLoad " + ok + " frame>0=" + (frame > 0) + " dur=" + this.duration + " pos=" + this.position + " bytes=" + this.getBytesLoaded() + "/" + this.getBytesTotal()); };
ev.onSoundComplete = function() { trace("event complete pos=" + this.position + " dur=" + this.duration); };
ev.loadSound("../../tools/assets/tone.mp3", false);
trace("after event loadSound: dur=" + ev.duration + " pos=" + ev.position + " bytes=" + ev.getBytesLoaded() + "/" + ev.getBytesTotal());
var st = new Sound();
st.onLoad = function(ok) { trace("stream onLoad " + ok + " dur=" + this.duration + " bytes=" + this.getBytesLoaded() + "/" + this.getBytesTotal()); };
st.onSoundComplete = function() { trace("stream complete pos=" + this.position + " dur=" + this.duration + " frame>5=" + (frame > 5)); };
st.loadSound("../../tools/assets/tone.mp3", true);
trace("after stream loadSound: dur=" + st.duration + " bytes=" + st.getBytesLoaded() + "/" + st.getBytesTotal());
var missing = new Sound();
missing.onLoad = function(ok) { trace("missing onLoad " + ok + " frame>0=" + (frame > 0)); };
missing.loadSound("no-such-file.mp3", false);
trace("after missing loadSound");
