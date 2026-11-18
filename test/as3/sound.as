// Sound、SoundChannel、SoundTransform、SoundMixer（鳴るのは 0.3 秒の小さな音）
// sound: Beep seconds=0.3
var show:Function = function(t:SoundTransform):String { return [t.volume, t.pan, t.leftToLeft, t.leftToRight, t.rightToLeft, t.rightToRight].join(" "); };
trace(show(new SoundTransform()), "|", show(new SoundTransform(0.5, -0.25)), "|", show(new SoundTransform(2, 1)), "|", show(new SoundTransform(0.5, 0.5)));
var t:SoundTransform = new SoundTransform(); t.pan = -1; trace(show(t)); t.pan = 0.36; trace(show(t)); t.leftToRight = 0.3; trace(show(t)); t.leftToRight = 0; t.leftToLeft = 0.5; t.rightToRight = 0.25; trace(show(t)); t.volume = -1; trace(t.volume, getQualifiedClassName(t));
var s:Sound = new Beep();
trace(s, s is Sound, s is EventDispatcher, Math.round(s.length), s.bytesLoaded == s.bytesTotal, s.bytesTotal > 0, s.url, s.isBuffering, getQualifiedClassName(s));
var empty:Sound = new Sound(); trace(empty.length, empty.bytesLoaded, empty.bytesTotal, empty.url);
try { empty.play(); } catch (e0:ArgumentError) { trace("ArgumentError", e0.errorID); }
trace(show(SoundMixer.soundTransform), show(soundTransform), SoundMixer.bufferTime);
var quiet:SoundTransform = new SoundTransform(0.05, 0.5);
var ch:SoundChannel = s.play(0, 0, quiet);
trace(ch, ch is SoundChannel, ch is EventDispatcher, ch.position, show(ch.soundTransform), ch.soundTransform === ch.soundTransform, ch.soundTransform === quiet);
quiet.volume = 0.5; trace(ch.soundTransform.volume); ch.soundTransform = new SoundTransform(0.02); trace(show(ch.soundTransform));
ch.addEventListener(Event.SOUND_COMPLETE, function(e:Event):void { kept.push(e); trace("complete", e.target == ch, e.type, e.bubbles, Math.round(ch.position / 100)); var again:SoundChannel = s.play(250, 0, new SoundTransform(0.02)); again.addEventListener(Event.SOUND_COMPLETE, function(e2:Event):void { kept.push(e2); trace("complete again", Math.round(again.position / 100)); }); });
var stopped:SoundChannel = s.play(100, 0, new SoundTransform(0.02)); trace(stopped.position); stopped.addEventListener(Event.SOUND_COMPLETE, function(e:Event):void { kept.push(e); trace("must not complete"); }); stopped.stop(); trace(stopped.position); stopped.stop();
SoundMixer.soundTransform = new SoundTransform(0.5, 0); trace(show(SoundMixer.soundTransform)); soundTransform = new SoundTransform(0.25); trace(show(soundTransform)); var sp:Sprite = new Sprite(); trace(show(sp.soundTransform));
try { ch.soundTransform = null; } catch (e1:TypeError) { trace("TypeError", e1.errorID); }
try { SoundMixer.soundTransform = null; } catch (e2:TypeError) { trace("TypeError", e2.errorID); }
var late:SoundChannel = s.play(1000, 0, new SoundTransform(0.02)); trace(late == null ? "null" : late.position);
var probe:SoundChannel = s.play(0, 0, new SoundTransform(0.016, 0.3)); trace(show(probe.soundTransform)); probe.soundTransform = new SoundTransform(0.025, -0.7); trace(show(probe.soundTransform)); probe.stop();
SoundMixer.soundTransform = new SoundTransform(0.126, 0.3); trace(show(SoundMixer.soundTransform)); sp.soundTransform = new SoundTransform(0.135, -0.3); trace(show(sp.soundTransform)); SoundMixer.soundTransform = new SoundTransform(0.5);
var values:Array = []; for each (var v:Number in [0.29, 0.57, 0.58, 1.13, 0.07, 0.14, 0.28, 1.15, -0.29, 2.3]) { sp.soundTransform = new SoundTransform(v); values.push(sp.soundTransform.volume); } trace(values);
//// members
public var kept:Array = [];
//// class
class Beep extends Sound { }
