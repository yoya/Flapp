// Date: 読み出し、setter、UTC。実行する場所の時差に依らない形で確かめる（toString と getTimezoneOffset は使わない）。
var d = new Date(2020, 0, 31, 12, 34, 56, 789);
function show(label, x) { trace(label + ": " + x.getFullYear() + "-" + (x.getMonth() + 1) + "-" + x.getDate() + " (" + x.getDay() + ") " + x.getHours() + ":" + x.getMinutes() + ":" + x.getSeconds() + "." + x.getMilliseconds() + " year=" + x.getYear()); }
show("new", d);
trace("typeof=" + typeof d + " valueOf==getTime " + (d.valueOf() == d.getTime()) + " instanceof " + (d instanceof Date));
d.setMonth(1); show("setMonth(1)", d);
d.setDate(0); show("setDate(0)", d);
d.setFullYear(2024, 1, 29); show("setFullYear(2024,1,29)", d);
d.setFullYear(2023); show("setFullYear(2023)", d);
d.setHours(25); show("setHours(25)", d);
d.setMinutes(-1); show("setMinutes(-1)", d);
d.setSeconds(61); show("setSeconds(61)", d);
d.setMilliseconds(1000); show("setMilliseconds(1000)", d);
d.setHours(1, 2, 3, 4); show("setHours(1,2,3,4)", d);
d.setMonth(11, 31); show("setMonth(11,31)", d);
d.setYear(99); show("setYear(99)", d);
d.setYear(2005); show("setYear(2005)", d);
trace("returns " + (d.setSeconds(0) == d.getTime()) + " " + typeof d.setMinutes(0) + " " + d.setTime(86400000) + " " + d.getTime());
var u = new Date(Date.UTC(2000, 1, 29, 23, 59, 59, 999));
function showUTC(label, x) { trace(label + ": " + x.getTime() + " " + x.getUTCFullYear() + "-" + (x.getUTCMonth() + 1) + "-" + x.getUTCDate() + " (" + x.getUTCDay() + ") " + x.getUTCHours() + ":" + x.getUTCMinutes() + ":" + x.getUTCSeconds() + "." + x.getUTCMilliseconds()); }
showUTC("utc", u);
u.setUTCMilliseconds(1000); showUTC("setUTCMilliseconds(1000)", u);
u.setUTCHours(-1); showUTC("setUTCHours(-1)", u);
u.setUTCDate(31); showUTC("setUTCDate(31)", u);
u.setUTCMonth(0, 1); showUTC("setUTCMonth(0,1)", u);
u.setUTCFullYear(1969, 11, 31); showUTC("setUTCFullYear(1969,11,31)", u);
u.setUTCMinutes(90, 90, 90); showUTC("setUTCMinutes(90,90,90)", u);
u.setUTCSeconds(-1); showUTC("setUTCSeconds(-1)", u);
trace("Date.UTC " + Date.UTC(1970, 0, 1) + " " + Date.UTC(2000, 0) + " " + Date.UTC(99, 11, 31) + " " + Date.UTC(2000) + " " + Date.UTC(2000, 0, 1, 0, 0, 0, 0.9) + " " + Date.UTC(2000, 12, 1));
show("two digit year", new Date(99, 0, 1));
show("defaults", new Date(2020, 5));
show("overflow", new Date(2020, 12, 32, 24, 60, 60, 1000));
trace("one number " + new Date(1234567890123).getTime() + " " + new Date(-1).getTime() + " " + new Date(1.9).getTime());
trace("invalid " + new Date(NaN).getTime() + " " + (new Date(undefined).getTime() > 1600000000000) + " " + new Date("abc").getTime() + " " + new Date(NaN).getFullYear());
var e = new Date(0); e.setTime(NaN); trace("setTime(NaN) " + e.getTime() + " " + e.getUTCDate());
e.setTime(0); e.setUTCFullYear(undefined); trace("setUTCFullYear(undefined) " + e.getTime());
trace("now " + (new Date().getTime() > 1600000000000) + " " + typeof Date() + " " + (Date() == new Date().toString()));
