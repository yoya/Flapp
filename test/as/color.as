// Color: setRGB / getRGB / setTransform / getTransform
// sprite: 1 name box depth 1 square 40 at 20,20
var c = new Color(box);
function show(label, col) { var t = col.getTransform(); trace(label + ": rgb=" + col.getRGB() + " ra=" + t.ra + " rb=" + t.rb + " ga=" + t.ga + " gb=" + t.gb + " ba=" + t.ba + " bb=" + t.bb + " aa=" + t.aa + " ab=" + t.ab); }
trace("typeof " + typeof c + " " + (c instanceof Color) + " " + typeof c.getTransform());
show("initial", c);
c.setRGB(0x336699); show("setRGB(0x336699)", c); trace("alpha " + box._alpha);
c.setTransform({ra: 50, rb: 100, ga: 25, gb: -50, ba: 0, bb: 255, aa: 80, ab: 10}); show("setTransform all", c); trace("alpha " + box._alpha);
c.setTransform({ra: 33.3}); show("setTransform {ra:33.3}", c);
c.setTransform({rb: 300, gb: -300, aa: 1000, ab: 0.5}); show("setTransform big", c);
box._alpha = 50; show("_alpha=50", c);
c.setRGB(-1); show("setRGB(-1)", c);
c.setRGB(0x1ffffff); show("setRGB(0x1ffffff)", c);
c.setRGB(undefined); show("setRGB(undefined)", c);
c.setRGB("255"); show("setRGB(\"255\")", c);
c.setTransform(undefined); show("setTransform(undefined)", c);
var names = "";
for (var k in c.getTransform()) { names += k + " "; }
trace("keys " + names);
var byName = new Color("box"); show("by name", byName);
var none = new Color(nothing); trace("no target: " + none.getRGB() + " " + none.getTransform() + " " + none.setRGB(1));
var gone = new Color("nothing"); trace("bad name: " + gone.getRGB() + " " + gone.getTransform());
var root = new Color(this); root.setRGB(0x010203); show("root", root);
