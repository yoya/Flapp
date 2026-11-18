// setMask: 画面で確かめる（trace は補助）
// sprite: 1 name a depth 1 square 60 at 20,20
// sprite: 2 name b depth 2 square 40 at 50,50
// sprite: 3 name c depth 3 square 60 at 120,20
// sprite: 4 name d depth 4 square 40 at 150,50
// sprite: 5 name e depth 5 square 30 at 20,110
// sprite: 6 name f depth 6 square 30 at 35,120
// sprite: 7 name g depth 7 square 30 at 120,110
// sprite: 8 name h depth 8 square 30 at 135,120
trace("setMask returns " + a.setMask(b));
c.setMask(d); c.setMask(null);
e.setMask(f); f._x = 40; f._rotation = 30;
g.setMask(h); h._visible = false;
trace("mask visible " + b._visible + " " + typeof a.setMask);
stop();
