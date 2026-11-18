// 数値の書式（toFixed / toExponential / toPrecision / toString(基数) と、大きな数の表記）
var vals:Array = [0.5, 0.9, 0.51, 0.49, -0.9, -0.2, 0.05, 0.95, 0.45, 0.55, 0.15, 0.25, 0.75, 0.85, 1.25, 1.35, 2.25, 2.675, 1.005, 10.5, 11.5, 0.005, 0.015, 0.025, 0.035, 0.045, 99.995, 0.999, 9.5, 99.5, 1e-7, 123.456, 5e-7, 0.0005, 1.45, 8.345, 1.55, 2.45, 2.55, 1234.5, 0];
var out:Array;
for (var p:int = 0; p <= 3; p++) { out = []; for each (var v:Number in vals) out.push(v.toFixed(p)); trace("F" + p, out.join(" ")); }
for (p = 0; p <= 3; p++) { out = []; for each (v in vals) out.push(v.toExponential(p)); trace("E" + p, out.join(" ")); }
for (p = 1; p <= 4; p++) { out = []; for each (v in vals) out.push(v.toPrecision(p)); trace("P" + p, out.join(" ")); }
trace((255.5).toString(16), (1e21).toString(16), (-0.5).toString(2), (4294967296).toString(16), (1e15).toString(36), (0.1).toString(3), (123.9).toString(8), Number(NaN).toString(2), Number(1 / 0).toString(16), (2147483648).toString(2), (-2147483649).toString(16));
trace(1e21, 1e21 + 1e6, 9.999999999999999e22, 1.2e21, 123456789e15, 5e22, 1.9999999999999998e21, 12345678901234567890123, 1.00000000000001e21, 1.000000000000001e21, 7.123456789012349e30, 7.1234567890123451e30);
