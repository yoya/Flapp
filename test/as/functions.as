// 関数
trace("-- basics");
function add(a, b) { return a + b; }
trace(add(1, 2) + " " + add(1) + " " + add(1, 2, 3) + " " + add.length);
function noReturn() {}
trace(noReturn());
var anon = function(x) { return x * 2; };
trace(anon(4) + " " + typeof anon + " " + anon);
trace("-- arguments");
function args() { return arguments.length + ":" + arguments[0] + ":" + arguments[2] + ":" + (arguments.callee == args); }
trace(args(1, 2, 3));
trace(args());
function sum() { var t = 0; var i = 0; for (; i < arguments.length; i++) t += arguments[i]; return t; }
trace(sum(1, 2, 3, 4));
trace("-- scope / closures");
var g = "global";
function outer() {
  var g = "local";
  function inner() { return g; }
  return inner();
}
trace(outer() + " " + g);
function counter() { var c = 0; return function() { return ++c; }; }
var c1 = counter(); var c2 = counter();
trace(c1() + " " + c1() + " " + c2() + " " + c1());
function leak() { leaked = 5; var hidden = 6; }
leak();
trace(leaked + " " + typeof hidden);
function shadow(g) { g = "param"; return g; }
trace(shadow("x") + " " + g);
var fns = [];
var i = 0;
for (; i < 3; i++) fns.push(function() { return i; });
trace(fns[0]() + " " + fns[2]());
trace("-- this");
var obj = {name: "obj", who: function() { return this.name; }};
trace(obj.who());
var loose = obj.who;
trace(typeof loose());
function plain() { return this; }
trace(plain() + " " + (plain() == this));
trace("-- call / apply");
function greet(greeting, mark) { return greeting + " " + this.name + mark; }
trace(greet.call(obj, "hi", "!"));
trace(greet.apply(obj, ["yo", "?"]));
trace(greet.call({name: "other"}, "hey"));
trace(greet.apply(obj));
trace("-- recursion");
function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }
trace(fact(10) + " " + fact(20) + " " + fact(25));
function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
trace(fib(15));
trace("-- function properties");
add.note = "hello";
trace(add.note + " " + typeof add.prototype + " " + (add.prototype.constructor == add));
trace(typeof Function + " " + (add instanceof Function) + " " + typeof add.call);
trace("-- nested definitions and hoisting");
trace(typeof later);
function later() { return 1; }
trace(typeof notYet);
var notYet = function() {};
