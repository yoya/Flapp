// Sound.load: ローカルの MP3（tools/assets/tone.mp3、0.3 秒）を読み込んで鳴らす。読み込みの直後に play する（よくある書き方）
addEventListener(Event.ENTER_FRAME, function(e:Event):void { frame++; });
sound = new Sound();
trace(sound.length, sound.bytesLoaded, sound.bytesTotal, sound.url, sound.isBuffering);
sound.addEventListener(Event.OPEN, onEvent); sound.addEventListener(ProgressEvent.PROGRESS, onEvent);
sound.addEventListener(Event.COMPLETE, onEvent); sound.addEventListener(IOErrorEvent.IO_ERROR, onEvent);
sound.load(new URLRequest("../../tools/assets/tone.mp3"));
trace("after load", sound.url, sound.bytesLoaded);
channel = sound.play();
trace("play", channel != null);
channel.addEventListener(Event.SOUND_COMPLETE, onEvent);
//// members
public var kept:Array = [];
public var frame:int = 0;
public var sound:Sound;
public var channel:SoundChannel;
public function onEvent(e:Event):void {
  kept.push(e);
  var more:String = "";
  // progress は、読み込みの区切りごとに何回か届く（回数は、読み方しだい）。最後の 1 回だけを見る。
  if (e.type == ProgressEvent.PROGRESS && ProgressEvent(e).bytesLoaded < ProgressEvent(e).bytesTotal) return;
  if (e.type == ProgressEvent.PROGRESS) more = " " + ProgressEvent(e).bytesLoaded + "/" + ProgressEvent(e).bytesTotal;
  if (e.type == Event.COMPLETE) more = " length=" + Math.round(sound.length) + " " + sound.bytesLoaded + "/" + sound.bytesTotal;
  if (e.type == Event.SOUND_COMPLETE) more = " position=" + Math.round(channel.position);
  trace(e.type, frame > 0, more);
}
