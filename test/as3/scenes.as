// シーンとフレームラベル（DefineSceneAndFrameLabelData）。currentFrame はシーンの中の番号で、ラベルは今のシーンの中で探す
// frames: 6
// scene: Alpha frame=1
// scene: Beta frame=4
// label: start frame=1
// label: middle frame=5
// label: last frame=6
// framelabel: middle frame=5
var show:Function = function(s:Scene):String { var out:Array = []; for each (var l:FrameLabel in s.labels) out.push(l.name + "@" + l.frame); return s.name + ":" + s.numFrames + ":" + out.join(","); };
var go:Function = function(frame:Object, scene:String = null):void { try { gotoAndStop(frame, scene); trace(currentScene.name, currentFrame, currentLabel, currentFrameLabel, currentLabels.length); } catch (e:ArgumentError) { trace("ArgumentError", e.errorID); } };
trace(scenes.length, show(scenes[0]), "|", show(scenes[1]));
trace(currentScene.name, currentFrame, totalFrames, framesLoaded, currentLabel, currentFrameLabel, currentLabels.length);
go(2, "Beta");
go("middle");
go(3);
go(1);
go("start");
go("last", "Alpha");
go("start", "Alpha");
go(3, "Alpha");
go(5);
go(0);
go(1, "Nope");
go("last");
go(2, "Beta");
nextScene(); trace(currentScene.name, currentFrame, isPlaying);
prevScene(); trace(currentScene.name, currentFrame, isPlaying);
stop(); prevScene(); trace(currentScene.name, currentFrame, isPlaying);
stop(); nextScene(); trace(currentScene.name, currentFrame, isPlaying);
stop();
trace(currentScene == currentScene, scenes == scenes, scenes[0] == scenes[0], getQualifiedClassName(currentScene), getQualifiedClassName(currentLabels[0]));
var l:FrameLabel = new FrameLabel("x", 3); var s:Scene = new Scene("y", [l], 7); trace(l.name, l.frame, s.name, s.numFrames, s.labels.length, s.labels[0] == l);
var mc:MovieClip = new MovieClip(); trace(mc.scenes.length, mc.currentScene.name, mc.currentScene.numFrames, mc.currentLabels.length, mc.currentFrame, mc.totalFrames);
