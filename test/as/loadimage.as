// loadMovie と MovieClipLoader で、ローカルの画像（tools/assets/pic.png / pic.jpg / pic.gif、32×24 px）を読み込む
// sprite: 1 frames 1 name box depth 1 square 40 at 10,10
var frame = 0;
box.tag = "kept?";
box._x = 50;
box._xscale = 200;
box.onEnterFrame = function() {};
box.loadMovie("../../tools/assets/pic.png");
trace("after loadMovie: " + box._width + " " + box._height + " " + box.tag + " " + typeof box.onEnterFrame + " " + box._currentframe + "/" + box._totalframes);
var holder = this.createEmptyMovieClip("holder", 5);
holder._y = 100;
var loader = new MovieClipLoader();
var listener = {};
listener.onLoadStart = function(t) { trace("onLoadStart " + t + " frame>0=" + (frame > 0)); };
listener.onLoadProgress = function(t, loaded, total) { if (loaded == total) trace("onLoadProgress " + t + " " + loaded + "/" + total); };
listener.onLoadComplete = function(t, status) { trace("onLoadComplete " + t + " status=" + status + " size=" + t._width + "x" + t._height); };
listener.onLoadInit = function(t) { trace("onLoadInit " + t + " size=" + t._width + "x" + t._height + " frames=" + t._currentframe + "/" + t._totalframes); };
listener.onLoadError = function(t, error, status) { trace("onLoadError " + t + " " + error + " " + status); };
loader.addListener(listener);
trace("loadClip " + loader.loadClip("../../tools/assets/pic.jpg", holder));
var p = loader.getProgress(holder);
trace("progress right after: " + p.bytesLoaded + "/" + p.bytesTotal);
this.createEmptyMovieClip("gif", 6);
gif._x = 120;
loader.loadClip("../../tools/assets/pic.gif", gif);
onEnterFrame = function() {
  frame++;
  if (frame == 3) {
    trace("frame 3 box: " + box._width + " " + box._height + " x=" + box._x + " xscale=" + box._xscale + " tag=" + box.tag + " " + typeof box.onEnterFrame + " " + box._currentframe + "/" + box._totalframes + " name=" + box._name);
    trace("frame 3 holder: " + holder._width + " " + holder._height + " y=" + holder._y);
    var q = loader.getProgress(holder);
    trace("progress: " + q.bytesLoaded + "/" + q.bytesTotal + " gif=" + gif._width + "x" + gif._height);
    trace("box size via getBounds: " + box.getBounds(box).xMax + " " + box.getBounds(box).yMax);
  }
};
