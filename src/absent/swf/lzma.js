// LZMA（ZWS）の展開を外した版。ZWS の SWF は読めない。
export function lzmaDecode() {
  throw Object.assign(new Error('LZMA (ZWS) is not included in this build'), { name: 'SWFError' });
}
