// クラス、継承、インターフェース、クロージャ
var a:Animal = new Animal("generic");
var d:Dog = new Dog("Pochi");
var c:Animal = new Cat("Tama", 3);
trace(a.speak(), d.speak(), c.speak());
trace(a, d, c, String(d), "" + c);
trace(d is Animal, d is Dog, d is Cat, d is Speaker, a is Speaker, c is Speaker, d as Cat, (d as Animal) == d);
trace(Animal.count, Dog.count, Animal.KIND, Dog.describe(d));
trace(d.legs, d.name, d.nickname); d.nickname = "P"; trace(d.nickname, d.name);
trace("-- dynamic / sealed");
try { Object(d).tail = 1; } catch (e:ReferenceError) { trace("sealed", e.errorID); }
try { trace(Object(d).tail); } catch (e2:ReferenceError) { trace("sealed read", e2.errorID); }
var bag:Bag = new Bag(); bag.anything = 5; bag["x y"] = 6; trace(bag.anything, bag["x y"], bag.missing, "anything" in bag, bag.hasOwnProperty("anything"), bag.hasOwnProperty("size"), "size" in bag);
delete bag.anything; trace(bag.anything, delete bag.size, bag.size);
trace("-- closures");
var speak:Function = d.speak; trace(speak(), speak.call(c), speak == d.speak);
var makers:Array = [];
for (var i:int = 0; i < 3; i++) makers.push(function():int { return i * 10; });
trace(makers[0](), makers[1](), makers[2]());
var counter:Function = (function():Function { var n:int = 0; return function():int { return ++n; }; })();
trace(counter(), counter(), counter());
var sum:Function = function(first:int, second:int = 10, ...rest):String { return first + "," + second + "," + rest.length + "," + rest; };
trace(sum(1), sum(1, 2), sum(1, 2, 3, 4), sum.length);
var args:Function = function():String { return arguments.length + ":" + arguments[1]; }; trace(args("a", "b", "c"));
trace(sum.apply(null, [5, 6, 7]), sum.call(null, 8));
trace("-- static / const / getter");
trace(Counter.next(), Counter.next(), Counter.value, Counter.LIMIT);
try { Object(Counter).LIMIT = 5; } catch (e3:ReferenceError) { trace("const write", e3.errorID); }
var t:Temp = new Temp(); t.celsius = 100; trace(t.celsius, t.fahrenheit);
try { Object(t).fahrenheit = 1; } catch (e4:ReferenceError) { trace("read only", e4.errorID); }
trace("-- super and override");
var p:Puppy = new Puppy("Koro"); trace(p.speak(), p.legs, p.describeSelf(), p is Dog, Object(p).constructor == Puppy);
trace("-- this in function");
var o:Object = {v: 1, f: function():* { return this.v; }}; trace(o.f());
var g:Function = o.f; trace(g.call({v: 2}), g.apply({v: 3}, []));
trace("-- class objects");
trace(Dog, Dog.prototype != null, Object(d).constructor, d is Object, Animal is Class, getQualifiedClassName(d), getQualifiedClassName(Dog), getQualifiedClassName(5), getQualifiedClassName("s"), getQualifiedClassName(null), getQualifiedClassName([]));
var K:Class = Cat; var k:Object = new K("Mike", 9); trace(k.speak(), k is Cat);
try { var bad:Dog = Dog(c); trace("no error"); } catch (e5:TypeError) { trace("cast", e5.errorID); }
trace(Dog(d) == d, Animal(d) == d, int("42") + 1, String(42) + 1, Array(3).length, Array(1, 2).length, Object(1) is Number, Boolean("") );
//// class
interface Speaker { function speak():String; }
class Animal {
  public static var count:int = 0;
  public static const KIND:String = "animal";
  public var name:String;
  protected var sound:String = "...";
  public function Animal(name:String) { this.name = name; count++; }
  public function speak():String { return name + " says " + sound; }
  public function get legs():int { return 4; }
  public function toString():String { return "[Animal " + name + "]"; }
}
class Dog extends Animal implements Speaker {
  private var nick:String = null;
  public function Dog(name:String) { super(name); sound = "wan"; }
  public function get nickname():String { return nick == null ? name : nick; }
  public function set nickname(v:String):void { nick = v; }
  public static function describe(d:Dog):String { return "dog:" + d.name + ":" + count; }
}
class Puppy extends Dog {
  public function Puppy(name:String) { super(name + " Jr."); }
  override public function speak():String { return super.speak() + "!"; }
  override public function get legs():int { return super.legs + 0; }
  public function describeSelf():String { return sound + "/" + this.sound; }
}
class Cat extends Animal implements Speaker {
  private var lives:int;
  public function Cat(name:String, lives:int) { super(name); this.lives = lives; sound = "nya"; }
  override public function speak():String { return super.speak() + " x" + lives; }
  override public function toString():String { return "[Cat]"; }
}
dynamic class Bag { public var size:int = 1; }
class Counter {
  public static const LIMIT:int = 3;
  private static var n:int = 0;
  public static function next():int { return ++n; }
  public static function get value():int { return n; }
}
class Temp {
  private var c:Number = 0;
  public function get celsius():Number { return c; }
  public function set celsius(v:Number):void { c = v; }
  public function get fahrenheit():Number { return c * 9 / 5 + 32; }
}
