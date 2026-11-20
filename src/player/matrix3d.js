// 3D 変形の計算。行列は 16 個の数の配列で、並びは Matrix3D.rawData と同じ列優先（[0..3] が x 軸の写る先、[12..14] が平行移動）。
// 点は列ベクトルで、行列を左から掛ける。単位は px。
// 規則は、実機の Matrix3D・DisplayObject の値から確かめた（test/as3/threed.as）。

const DEG = Math.PI / 180;

export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** a × b（b を先に掛ける）。 */
export function multiply(a, b) {
  const out = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = s;
    }
  }
  return out;
}

/** 軸 axis（{ x, y, z }。長さは 1 に直す）のまわりに deg 度回す行列。 */
export function rotation(deg, axis) {
  const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const [x, y, z] = [axis.x / len, axis.y / len, axis.z / len];
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG), t = 1 - c;
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
}

export const translation = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
export const scaling = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];

/**
 * 表示オブジェクトの値から行列を作る: 拡大 → x 軸の回転 → y 軸 → z 軸 → 平行移動の順に掛ける。
 * c は { x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ }（角度は度）。
 */
export function compose(c) {
  let m = scaling(c.scaleX, c.scaleY, c.scaleZ);
  m = multiply(rotation(c.rotationX, { x: 1, y: 0, z: 0 }), m);
  m = multiply(rotation(c.rotationY, { x: 0, y: 1, z: 0 }), m);
  m = multiply(rotation(c.rotationZ, { x: 0, y: 0, z: 1 }), m);
  return multiply(translation(c.x, c.y, c.z), m);
}

/** compose の逆（角度はラジアン）。{ translation, rotation, scale }（どれも { x, y, z }）。 */
export function decompose(m) {
  const translationPart = { x: m[12], y: m[13], z: m[14] };
  let sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  if (determinant3(m) < 0) sx = -sx;
  const r = (col, row, s) => (s ? m[col * 4 + row] / s : 0);
  // 回転 R = Rz · Ry · Rx の成分から角度を取る。
  const r20 = r(0, 2, sx), r21 = r(1, 2, sy), r22 = r(2, 2, sz), r10 = r(0, 1, sx), r00 = r(0, 0, sx);
  const ry = Math.asin(Math.min(Math.max(-r20, -1), 1));
  let rx, rz;
  if (Math.abs(r20) < 0.999999) { rx = Math.atan2(r21, r22); rz = Math.atan2(r10, r00); } else { rx = Math.atan2(-r(2, 1, sz), r(1, 1, sy)); rz = 0; }
  return { translation: translationPart, rotation: { x: rx, y: ry, z: rz }, scale: { x: sx, y: sy, z: sz } };
}

const determinant3 = (m) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);

export function determinant(m) {
  const [a, b, c, d] = [0, 1, 2, 3].map((i) => m[i * 4]);
  const minor = (skip) => {
    const cols = [0, 1, 2, 3].filter((k) => k !== skip);
    const e = (col, row) => m[cols[col] * 4 + row];
    return e(0, 1) * (e(1, 2) * e(2, 3) - e(1, 3) * e(2, 2)) - e(1, 1) * (e(0, 2) * e(2, 3) - e(0, 3) * e(2, 2)) + e(2, 1) * (e(0, 2) * e(1, 3) - e(0, 3) * e(1, 2));
  };
  return a * minor(0) - b * minor(1) + c * minor(2) - d * minor(3);
}

/** 逆行列（逆が無ければ null）。 */
export function invert(m) {
  const inv = new Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (!det || !Number.isFinite(det)) return null;
  return inv.map((v) => v / det);
}

/** 点 (x, y, z, w) を写した [x, y, z, w]。 */
export function transform(m, x, y, z, w = 1) {
  return [0, 1, 2, 3].map((row) => m[row] * x + m[4 + row] * y + m[8 + row] * z + m[12 + row] * w);
}

/** 2D の行列（{ a, b, c, d, tx, ty }。tx, ty は px）を、z を変えない 3D の行列にする。 */
export const lift = (m) => [m.a, m.b, 0, 0, m.c, m.d, 0, 0, 0, 0, 1, 0, m.tx, m.ty, 0, 1];

/**
 * 透視投影。center（px）を中心に、焦点距離 focal（px）で、点 p（[x, y, z]）を z = 0 の面へ写す: center + (p - center) × focal / (focal + z)。
 * 視点より後ろ（focal + z が 0 以下）なら null。
 */
export function project(p, center, focal) {
  const k = focal + p[2];
  if (k <= 0) return null;
  const s = focal / k;
  return { x: center.x + (p[0] - center.x) * s, y: center.y + (p[1] - center.y) * s };
}

/** 視野角 fov（度）と幅 width（px）から、焦点距離: (width / 2) / tan(fov / 2)。 */
export const focalLength = (fov, width) => width / 2 / Math.tan((fov * DEG) / 2);
