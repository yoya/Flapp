// LoadVars / MovieClipLoader / SharedObject。外部の読み込みは行わない（存在しないファイルを指定して、失敗の通知を確かめる）。
// frames: 12
// sprite: 1 name holder depth 1
var lv = new LoadVars();
trace("typeof " + typeof lv + " " + (lv instanceof LoadVars) + " [" + lv + "] loaded=" + lv.loaded + " contentType=" + lv.contentType);
lv.a = 1; lv.b = "x y&z=1"; lv.c = undefined; lv.d = null; lv.e = true; lv.f = 1.5;
trace("toString " + lv.toString());
var lv2 = new LoadVars();
lv2.decode("p=1&q=hello%20world&r=a+b&s&t=&p=2&%41=%42");
var names = "";
for (var k in lv2) { names += k + "=[" + lv2[k] + "] "; }
trace("decode " + names);
trace("bytes " + lv2.getBytesLoaded() + " " + lv2.getBytesTotal());
lv2.onLoad = function(ok) { trace("lv2 onLoad " + ok + " loaded=" + this.loaded + " bytes=" + this.getBytesLoaded() + "/" + this.getBytesTotal()); };
trace("load returns " + lv2.load("no-such-file.txt") + " loaded=" + lv2.loaded + " " + lv2.load());
var lv3 = new LoadVars();
lv3.onData = function(src) { trace("lv3 onData [" + src + "] " + typeof src); };
lv3.load("no-such-file-2.txt");
var mcl = new MovieClipLoader();
var l = new Object();
l.onLoadStart = function(target) { trace("mcl start " + target); };
l.onLoadError = function(target, code) { trace("mcl error " + target + " " + code); };
l.onLoadInit = function(target) { trace("mcl init " + target); };
l.onLoadComplete = function(target) { trace("mcl complete " + target); };
trace("mcl " + typeof mcl + " add=" + mcl.addListener(l) + " loadClip=" + mcl.loadClip("no-such-file.swf", holder) + " bad target=" + mcl.loadClip("no-such-file.swf", nothing));
var p = mcl.getProgress(holder); trace("progress " + typeof p + " " + typeof p.bytesLoaded + " " + typeof mcl.getProgress(nothing));
holder.loadMovie("no-such-file-3.swf"); holder.loadVariables("no-such-file-4.txt");
var so = SharedObject.getLocal("flapp_test");
so.clear();
trace("so " + typeof so + " " + (so instanceof SharedObject) + " data=" + typeof so.data + " size=" + so.getSize());
so.data.n = 42; so.data.s = "str"; so.data.list = [1, 2, 3];
trace("flush " + so.flush() + " size>0 " + (so.getSize() > 0));
var again = SharedObject.getLocal("flapp_test");
trace("again same=" + (again == so) + " n=" + again.data.n + " list=" + again.data.list);
so.clear(); trace("after clear n=" + so.data.n + " size=" + so.getSize());
trace("bad " + SharedObject.getLocal() + " " + typeof SharedObject.getLocal("a b"));
trace("end of frame 1");
//// frame 2
trace("frame 2");
//// frame 3
trace("frame 3 holder=" + holder + " frames=" + holder._totalframes);
//// frame 12
trace("frame 12");
stop();
