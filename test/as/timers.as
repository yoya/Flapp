// setInterval / setTimeout
var n = 0;
var id = setInterval(function(a, b) {
  n++;
  trace("tick " + n + " " + a + b + " " + typeof this);
  if (n == 3) { clearInterval(id); trace("cleared"); }
}, 50, "x", "y");
var o = {count: 0};
o.step = function(msg) {
  this.count++;
  trace("method " + this.count + " " + msg);
  if (this.count == 2) clearInterval(this.id);
};
o.id = setInterval(o, "step", 180, "m");
var t = setTimeout(function() { trace("timeout once"); }, 600);
var never = setTimeout(function() { trace("never"); }, 400);
clearTimeout(never);
trace(typeof id + " " + (o.id > id) + " " + typeof setInterval(5, 10) + " " + typeof setInterval(o, "nothing"));
stop();
