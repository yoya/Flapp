// frames: 3
// sprite: Leaf frames=2
// sprite: Branch frames=3
// place: Leaf in=Branch frame=1 name=leafA
// place: Leaf in=Branch frame=2 name=leafB x=50 until=3
// place: Branch frame=1 name=first
// place: Branch frame=2 name=second y=50
// place: Leaf frame=3 name=late x=100
// タイムラインに置かれたクリップの、コンストラクタ・イベント・フレームスクリプトの順序。
// added / removed のイベントは Log.keep に保持する（実機のデバッガ版は、誰にも保持されなかったイベントを片付けるときに落ちる）。
// 同じ理由で、中の図形に届かないまま片付けられる addedToStage / removedFromStage のリスナーは、親のクリップには付けない。
Log.owner = this;
Log.add("Main constructor", "first=" + (first != null ? first.name : null), "second=" + (second != null ? second.name : null), numChildren);
addEventListener(Event.ENTER_FRAME, function(e:Event):void { Log.frame++; Log.add("Main enterFrame", "second=" + (second != null), "late=" + (late != null), numChildren); });
addEventListener(Event.FRAME_CONSTRUCTED, function(e:Event):void { Log.add("Main frameConstructed", "second=" + (second != null), numChildren); });
addEventListener(Event.EXIT_FRAME, function(e:Event):void { Log.add("Main exitFrame"); });
addFrameScript(0, function():void { Log.add("Main script 1"); }, 1, function():void { Log.add("Main script 2"); }, 2, function():void { Log.add("Main script 3"); stop(); });
//// members
public var first:MovieClip;
public var second:MovieClip;
public var late:MovieClip;
//// class
class Log {
  public static var frame:int = 0;
  public static var owner:MovieClip;
  public static var keep:Array = [];
  public static function add(...words):void { if (frame <= 5) trace(frame + ": " + words.join(" ")); }
}
class Leaf extends MovieClip {
  public function Leaf() {
    Log.add("  Leaf constructor", name, "parent=" + (parent != null ? parent.name : null), "stage=" + (stage != null), currentFrame, isPlaying);
    addEventListener(Event.ENTER_FRAME, function(e:Event):void { Log.add("  Leaf enterFrame", name, currentFrame, "parent=" + (parent != null)); });
    addEventListener(Event.ADDED, function(e:Event):void { Log.keep.push(e); Log.add("  Leaf added", name, e.target == e.currentTarget, "parent=" + (parent != null)); });
    addEventListener(Event.ADDED_TO_STAGE, function(e:Event):void { Log.keep.push(e); Log.add("  Leaf addedToStage", name); });
    addEventListener(Event.REMOVED, function(e:Event):void { Log.keep.push(e); Log.add("  Leaf removed", name, "parent=" + (parent != null)); });
    addFrameScript(0, function():void { Log.add("  Leaf script 1", name); }, 1, function():void { Log.add("  Leaf script 2", name); });
  }
}
class Branch extends MovieClip {
  public var leafA:MovieClip;
  public var leafB:MovieClip;
  public function Branch() {
    Log.add(" Branch constructor", name, "leafA=" + (leafA != null), "leafB=" + (leafB != null), numChildren, "parent=" + (parent != null ? parent.name : null));
    addEventListener(Event.ENTER_FRAME, function(e:Event):void { Log.add(" Branch enterFrame", name, currentFrame, "leafB=" + (leafB != null), numChildren); });
    addEventListener(Event.FRAME_CONSTRUCTED, function(e:Event):void { Log.add(" Branch frameConstructed", name, currentFrame, "leafB=" + (leafB != null), numChildren); });
    addEventListener(Event.ADDED, function(e:Event):void { Log.keep.push(e); Log.add(" Branch added", name, e.target.name, e.eventPhase); });
    addEventListener(Event.REMOVED, function(e:Event):void { Log.keep.push(e); Log.add(" Branch removed", name, e.target.name, e.eventPhase, "leafB=" + (leafB != null)); });
    addFrameScript(0, function():void { Log.add(" Branch script 1", name); }, 1, function():void { Log.add(" Branch script 2", name, "leafB=" + (leafB != null)); }, 2, function():void { Log.add(" Branch script 3", name, "leafB=" + (leafB != null)); });
  }
}
