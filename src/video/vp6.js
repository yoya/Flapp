// SPDX-License-Identifier: LGPL-2.1-or-later
/*
 * VP6 video decoder (the variants used by Flash: VP6F and VP6A).
 *
 * This file is a JavaScript port of the VP6 decoder of FFmpeg (libavcodec):
 *   vp6.c, vp56.c, vp56.h, vp56data.c, vp6data.h, vp6dsp.c, vpx_rac.h
 *                               Copyright (C) 2006  Aurelien Jacobs <aurel@gnuage.org>
 *   vpx_rac.c                   Copyright (c) 2010  Fiona Glaser <fiona@x264.com>
 *   vp3dsp.c                    Copyright (C) 2004  The FFmpeg project
 *   huffman.c                   Copyright (c) 2006  Konstantin Shishkov
 *                               Copyright (c) 2007  Loren Merritt
 *   h264chroma_template.c       Copyright (c) 2000, 2001  Fabrice Bellard
 *                               Copyright (c) 2002-2004  Michael Niedermayer <michaelni@gmx.at>
 *   videodsp_template.c         Copyright (c) 2002-2012  Michael Niedermayer
 *                               Copyright (C) 2012  Ronald S. Bultje
 * JavaScript port for Flapp.
 *
 * This file is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * This file is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * A copy of the GNU Lesser General Public License is in LICENSES/LGPL-2.1-or-later.txt.
 */

// VP6 の復号。Flapp のほかの部分は仕様書だけから書いているが、VP6 は公開された仕様が無いので、このファイルだけは
// FFmpeg の復号器を JavaScript に移したもの（そのため、このファイルだけ LGPL）。
// 対応するのは Flash で使う形（FLV の CodecID 4 と 5、SWF の埋め込みビデオ）で、絵は上下が反転していない。
// インターレース（マクロブロックごとに、1 行おきの 2 枚の絵として符号化できる形）のストリームも FFmpeg と同じに復号するが、
// 実機の Flash Player はこの印の付いたストリームを映さない（黒くなる）。アルファ付きのインターレースでは、FFmpeg は
// アルファの面で行の間隔を 2 倍にしておらず、絵が崩れる。ここでは色と同じに扱っている（正解を確かめる手段は無い）。
//
// 入力は信用できないデータとして扱う。配列の外を読まない・書かないこと、大きさの上限（MAX_VIDEO_PIXELS）を守ることは、
// 移したコードの側で保証する（FFmpeg が余白の付いたバッファに頼っている所は、座標を丸めて読む形にしてある）。
import { MAX_VIDEO_PIXELS, VideoError } from './h263.js';

// ---- 表（FFmpeg の vp56data.c と vp6data.h から、値を変えずに取り出したもの。多次元の表は 1 列に並べてある） ----
const COEFF_PARSE_TABLE = new Uint8Array([
  159, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 145, 165, 0, 0, 0, 0, 0, 0, 0, 0, 0, 140, 148,
  173, 0, 0, 0, 0, 0, 0, 0, 0, 135, 140, 155, 176, 0, 0, 0, 0, 0, 0, 0, 130, 134, 141, 157,
  180, 0, 0, 0, 0, 0, 0, 129, 130, 133, 140, 153, 177, 196, 230, 243, 254, 254,
]);
const DEF_MB_TYPES_STATS = new Uint8Array([
  69, 42, 1, 2, 1, 7, 44, 42, 6, 22, 1, 3, 0, 2, 1, 5, 0, 1, 0, 0, 229, 8, 1, 1,
  0, 8, 0, 0, 0, 0, 1, 2, 0, 1, 0, 0, 1, 1, 0, 0, 122, 35, 1, 1, 1, 6, 46, 34,
  0, 0, 1, 2, 0, 1, 0, 1, 1, 1, 0, 0,
]);
const PVA_TREE = new Int8Array([
  8, 0, 4, 1, 2, 2, 0, 0, -1, 0, 2, 3, -2, 0, -3, 0, 4, 4, 2, 5, -4, 0, -5, 0,
  2, 6, -6, 0, -7, 0,
]);
const PC_TREE = new Int8Array([
  4, 6, 2, 7, 0, 0, -1, 0, 4, 8, 2, 9, -2, 0, -3, 0, 2, 10, -4, 0, -5, 0,
]);
const COEFF_BIAS = new Uint8Array([
  0, 1, 2, 3, 4, 5, 7, 11, 19, 35, 67,
]);
const COEFF_BIT_LENGTH = new Uint8Array([
  0, 1, 2, 3, 4, 10,
]);
const REFERENCE_FRAME = new Uint8Array([
  1, 0, 1, 1, 1, 2, 2, 1, 2, 2,
]);
const AC_DEQUANT = new Uint8Array([
  94, 92, 90, 88, 86, 82, 78, 74, 70, 66, 62, 58, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43,
  42, 40, 39, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17,
  16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
]);
const DC_DEQUANT = new Uint8Array([
  47, 47, 47, 47, 45, 43, 43, 43, 43, 43, 42, 41, 41, 40, 40, 40, 40, 35, 35, 35, 35, 33, 33, 33,
  33, 32, 32, 32, 27, 27, 26, 26, 25, 25, 24, 24, 23, 23, 19, 19, 19, 19, 18, 18, 17, 16, 16, 16,
  16, 16, 15, 11, 11, 11, 10, 10, 9, 8, 7, 5, 3, 3, 2, 2,
]);
const PRE_DEF_MB_TYPE_STATS = new Uint8Array([
  9, 15, 32, 25, 7, 19, 9, 21, 1, 12, 14, 12, 3, 18, 14, 23, 3, 10, 0, 4, 41, 22, 1, 0,
  1, 31, 0, 0, 0, 0, 0, 1, 1, 7, 0, 1, 98, 25, 4, 10, 2, 3, 2, 3, 0, 2, 0, 2,
  0, 0, 11, 4, 1, 4, 0, 2, 3, 2, 0, 4, 48, 39, 1, 2, 11, 27, 29, 44, 7, 27, 1, 4,
  0, 3, 1, 6, 1, 2, 0, 0, 123, 37, 6, 4, 1, 27, 0, 0, 0, 0, 5, 8, 1, 7, 0, 1,
  12, 10, 0, 2, 49, 46, 3, 4, 7, 31, 42, 41, 0, 0, 2, 6, 1, 7, 1, 4, 2, 4, 0, 1,
  21, 32, 1, 2, 4, 10, 32, 43, 6, 23, 2, 3, 1, 19, 1, 6, 12, 21, 0, 7, 26, 14, 14, 12,
  0, 24, 0, 0, 0, 0, 55, 17, 1, 9, 0, 36, 5, 7, 1, 3, 26, 25, 1, 1, 2, 10, 67, 39,
  0, 0, 1, 1, 0, 14, 0, 2, 31, 26, 1, 6, 69, 83, 0, 0, 0, 2, 10, 29, 3, 12, 0, 1,
  0, 3, 0, 3, 2, 2, 0, 0, 209, 5, 0, 0, 0, 27, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1,
  0, 0, 0, 0, 103, 46, 1, 2, 2, 10, 33, 42, 0, 0, 1, 4, 0, 3, 0, 1, 1, 3, 0, 0,
  11, 20, 1, 4, 18, 36, 43, 48, 13, 35, 0, 2, 0, 5, 3, 12, 1, 2, 0, 0, 2, 5, 4, 5,
  0, 121, 0, 0, 0, 0, 0, 3, 2, 4, 1, 4, 2, 2, 0, 1, 14, 31, 9, 13, 14, 54, 22, 29,
  0, 0, 2, 6, 4, 18, 6, 13, 1, 5, 0, 1, 70, 44, 0, 1, 2, 10, 37, 46, 8, 26, 0, 2,
  0, 2, 0, 2, 0, 1, 0, 0, 175, 5, 0, 1, 0, 48, 0, 0, 0, 0, 0, 2, 0, 1, 0, 2,
  0, 1, 0, 0, 85, 39, 0, 0, 1, 9, 69, 40, 0, 0, 0, 1, 0, 3, 0, 1, 2, 3, 0, 0,
  8, 15, 0, 1, 8, 21, 74, 53, 22, 42, 0, 1, 0, 2, 0, 3, 1, 2, 0, 0, 83, 5, 2, 3,
  0, 102, 0, 0, 0, 0, 1, 3, 0, 2, 0, 1, 0, 0, 0, 0, 31, 28, 0, 0, 3, 14, 130, 34,
  0, 0, 0, 1, 0, 3, 0, 1, 3, 3, 0, 1, 141, 42, 0, 0, 1, 4, 11, 24, 1, 11, 0, 1,
  0, 1, 0, 2, 0, 0, 0, 0, 233, 6, 0, 0, 0, 8, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0,
  0, 1, 0, 0, 171, 25, 0, 0, 1, 5, 25, 21, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0,
  8, 19, 4, 10, 24, 45, 21, 37, 9, 29, 0, 3, 1, 7, 11, 25, 0, 2, 0, 1, 34, 16, 112, 21,
  1, 28, 0, 0, 0, 0, 6, 8, 1, 7, 0, 3, 2, 5, 0, 2, 17, 21, 68, 29, 6, 15, 13, 22,
  0, 0, 6, 12, 3, 14, 4, 10, 1, 7, 0, 3, 46, 42, 0, 1, 2, 10, 54, 51, 10, 30, 0, 2,
  0, 2, 0, 1, 0, 1, 0, 0, 159, 35, 2, 2, 0, 25, 0, 0, 0, 0, 3, 6, 0, 5, 0, 1,
  4, 4, 0, 1, 51, 39, 0, 1, 2, 12, 91, 44, 0, 0, 0, 2, 0, 3, 0, 1, 2, 3, 0, 1,
  28, 32, 0, 0, 3, 10, 75, 51, 14, 33, 0, 1, 0, 2, 0, 1, 1, 2, 0, 0, 75, 39, 5, 7,
  2, 48, 0, 0, 0, 0, 3, 11, 2, 16, 1, 4, 7, 10, 0, 2, 81, 25, 0, 0, 2, 9, 106, 26,
  0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 0, 100, 46, 0, 1, 3, 9, 21, 37, 5, 20, 0, 1,
  0, 2, 1, 2, 0, 1, 0, 0, 212, 21, 0, 1, 0, 9, 0, 0, 0, 0, 1, 2, 0, 2, 0, 0,
  2, 2, 0, 0, 140, 37, 0, 1, 1, 8, 24, 33, 0, 0, 1, 2, 0, 2, 0, 1, 1, 2, 0, 0,
  27, 29, 0, 1, 9, 25, 53, 51, 12, 34, 0, 1, 0, 3, 1, 5, 0, 2, 0, 0, 4, 2, 0, 0,
  0, 172, 0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 2, 0, 0, 0, 14, 23, 1, 3, 11, 53, 90, 31,
  0, 0, 0, 3, 1, 5, 2, 6, 1, 2, 0, 0, 80, 38, 0, 0, 1, 4, 69, 33, 5, 16, 0, 1,
  0, 1, 0, 0, 0, 1, 0, 0, 187, 22, 1, 1, 0, 17, 0, 0, 0, 0, 3, 6, 0, 4, 0, 1,
  4, 4, 0, 1, 123, 29, 0, 0, 1, 7, 57, 30, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0,
  16, 20, 0, 0, 2, 8, 104, 49, 15, 33, 0, 1, 0, 1, 0, 1, 1, 1, 0, 0, 133, 6, 1, 2,
  1, 70, 0, 0, 0, 0, 0, 2, 0, 4, 0, 3, 1, 1, 0, 0, 13, 14, 0, 0, 4, 20, 175, 20,
  0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 0, 194, 16, 0, 0, 1, 1, 1, 9, 1, 3, 0, 0,
  0, 1, 0, 1, 0, 0, 0, 0, 251, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 202, 23, 0, 0, 1, 3, 2, 9, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0,
]);
const FILTER_THRESHOLD = new Uint8Array([
  14, 14, 13, 13, 12, 12, 10, 10, 10, 10, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
  8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 7, 7, 7, 7, 7, 7, 6, 6, 6, 6, 6, 6,
  5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 2,
]);
const MB_TYPE_MODEL_MODEL = new Uint8Array([
  171, 83, 199, 140, 125, 104,
]);
const PMBTM_TREE = new Int8Array([
  4, 0, 2, 1, -8, 0, -4, 0, 8, 2, 6, 3, 4, 4, 2, 5, -24, 0, -20, 0, -16, 0, -12, 0,
  0, 0,
]);
const PMBT_TREE = new Int8Array([
  8, 1, 4, 2, 2, 4, 0, 0, -2, 0, 2, 5, -3, 0, -4, 0, 4, 3, 2, 6, -1, 0, -7, 0,
  4, 7, 2, 8, -5, 0, -6, 0, 2, 9, -8, 0, -9, 0,
]);
const CANDIDATE_PREDICTOR_POS = new Int8Array([
  0, -1, -1, 0, -1, -1, 1, -1, 0, -2, -2, 0, -2, -1, -1, -2, 1, -2, 2, -1, -2, -2, 2, -2,
]);
const DEF_FDV_VECTOR_MODEL = new Uint8Array([
  247, 210, 135, 68, 138, 220, 239, 246, 244, 184, 201, 44, 173, 221, 239, 253,
]);
const DEF_PDV_VECTOR_MODEL = new Uint8Array([
  225, 146, 172, 147, 214, 39, 156, 204, 170, 119, 235, 140, 230, 228,
]);
const DEF_COEFF_REORDER = new Uint8Array([
  0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 7, 7,
  7, 7, 7, 8, 8, 9, 9, 9, 9, 9, 9, 10, 10, 11, 11, 11, 11, 11, 11, 12, 12, 12, 12, 12,
  12, 13, 13, 13, 13, 13, 14, 14, 14, 14, 15, 15, 15, 15, 15, 15,
]);
const IL_COEFF_REORDER = new Uint8Array([
  0, 1, 0, 1, 1, 2, 5, 3, 2, 2, 2, 2, 4, 7, 8, 10, 9, 7, 5, 4, 2, 3, 5, 6,
  8, 9, 11, 12, 13, 12, 11, 10, 9, 7, 5, 4, 6, 7, 9, 11, 12, 12, 13, 13, 14, 12, 11, 9,
  7, 9, 11, 12, 14, 14, 14, 15, 13, 11, 13, 15, 15, 15, 15, 15,
]);
const DEF_RUNV_COEFF_MODEL = new Uint8Array([
  198, 197, 196, 146, 198, 204, 169, 142, 130, 136, 149, 149, 191, 249, 135, 201, 181, 154, 98, 117, 132, 126, 146, 169,
  184, 240, 246, 254,
]);
const SIG_DCT_PCT = new Uint8Array([
  237, 246, 231, 243,
]);
const PDV_PCT = new Uint8Array([
  253, 253, 254, 254, 254, 254, 254, 245, 253, 254, 254, 254, 254, 254,
]);
const FDV_PCT = new Uint8Array([
  254, 254, 254, 254, 254, 250, 250, 252, 254, 254, 254, 254, 254, 251, 251, 254,
]);
const DCCV_PCT = new Uint8Array([
  146, 255, 181, 207, 232, 243, 238, 251, 244, 250, 249, 179, 255, 214, 240, 250, 255, 244, 255, 255, 255, 255,
]);
const COEFF_REORDER_PCT = new Uint8Array([
  255, 132, 132, 159, 153, 151, 161, 170, 164, 162, 136, 110, 103, 114, 129, 118, 124, 125, 132, 136, 114, 110, 142, 135,
  134, 123, 143, 126, 153, 183, 166, 161, 171, 180, 179, 164, 203, 218, 225, 217, 215, 206, 203, 217, 229, 241, 248, 243,
  253, 255, 253, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
]);
const RUNV_PCT = new Uint8Array([
  219, 246, 238, 249, 232, 239, 249, 255, 248, 253, 239, 244, 241, 248, 198, 232, 251, 253, 219, 241, 253, 255, 248, 249,
  244, 238, 251, 255,
]);
const RACT_PCT = new Uint8Array([
  227, 246, 230, 247, 244, 255, 255, 255, 255, 255, 255, 255, 255, 209, 231, 231, 249, 249, 253, 255, 255, 255, 255, 255,
  225, 242, 241, 251, 253, 255, 255, 255, 255, 255, 255, 241, 253, 252, 255, 255, 255, 255, 255, 255, 255, 255, 248, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 240, 255, 248, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 240, 253, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 206, 203, 227, 239, 247, 255, 253, 255, 255, 255, 255, 207,
  199, 220, 236, 243, 252, 252, 255, 255, 255, 255, 212, 219, 230, 243, 244, 253, 252, 255, 255, 255, 255, 236, 237, 247,
  252, 253, 255, 255, 255, 255, 255, 255, 240, 240, 248, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 230, 233, 249, 255, 255, 255, 255, 255, 255, 255, 255, 238, 238, 250, 255, 255, 255, 255,
  255, 255, 255, 255, 248, 251, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  225, 239, 227, 231, 244, 253, 243, 255, 255, 253, 255, 232, 234, 224, 228, 242, 249, 242, 252, 251, 251, 255, 235, 249,
  238, 240, 251, 255, 249, 255, 253, 253, 255, 249, 253, 251, 250, 255, 255, 255, 255, 255, 255, 255, 251, 250, 249, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 243, 244, 250, 250, 255, 255,
  255, 255, 255, 255, 255, 249, 248, 250, 253, 255, 255, 255, 255, 255, 255, 255, 253, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
]);
const DCCV_LC = new Int16Array([
  122, 133, 0, 1, 78, 171, 139, 117, 168, 79, 133, 51, 0, 1, 169, 71, 214, 44, 210, 38, 142, -16, 0, 1,
  221, -30, 246, -3, 203, 17,
]);
const COEFF_GROUPS = new Uint8Array([
  0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
]);
const BLOCK_COPY_FILTER = new Int16Array([
  0, 128, 0, 0, -3, 122, 9, 0, -4, 109, 24, -1, -5, 91, 45, -3, -4, 68, 68, -4, -3, 45, 91, -5,
  -1, 24, 109, -4, 0, 9, 122, -3, 0, 128, 0, 0, -4, 124, 9, -1, -5, 110, 25, -2, -6, 91, 46, -3,
  -5, 69, 69, -5, -3, 46, 91, -6, -2, 25, 110, -5, -1, 9, 124, -4, 0, 128, 0, 0, -4, 123, 10, -1,
  -6, 110, 26, -2, -7, 92, 47, -4, -6, 70, 70, -6, -4, 47, 92, -7, -2, 26, 110, -6, -1, 10, 123, -4,
  0, 128, 0, 0, -5, 124, 10, -1, -7, 110, 27, -2, -7, 91, 48, -4, -6, 70, 70, -6, -4, 48, 92, -8,
  -2, 27, 110, -7, -1, 10, 124, -5, 0, 128, 0, 0, -6, 124, 11, -1, -8, 111, 28, -3, -8, 92, 49, -5,
  -7, 71, 71, -7, -5, 49, 92, -8, -3, 28, 111, -8, -1, 11, 124, -6, 0, 128, 0, 0, -6, 123, 12, -1,
  -9, 111, 29, -3, -9, 93, 50, -6, -8, 72, 72, -8, -6, 50, 93, -9, -3, 29, 111, -9, -1, 12, 123, -6,
  0, 128, 0, 0, -7, 124, 12, -1, -10, 111, 30, -3, -10, 93, 51, -6, -9, 73, 73, -9, -6, 51, 93, -10,
  -3, 30, 111, -10, -1, 12, 124, -7, 0, 128, 0, 0, -7, 123, 13, -1, -11, 112, 31, -4, -11, 94, 52, -7,
  -10, 74, 74, -10, -7, 52, 94, -11, -4, 31, 112, -11, -1, 13, 123, -7, 0, 128, 0, 0, -8, 124, 13, -1,
  -12, 112, 32, -4, -12, 94, 53, -7, -10, 74, 74, -10, -7, 53, 94, -12, -4, 32, 112, -12, -1, 13, 124, -8,
  0, 128, 0, 0, -9, 124, 14, -1, -13, 112, 33, -4, -13, 95, 54, -8, -11, 75, 75, -11, -8, 54, 95, -13,
  -4, 33, 112, -13, -1, 14, 124, -9, 0, 128, 0, 0, -9, 123, 15, -1, -14, 113, 34, -5, -14, 95, 55, -8,
  -12, 76, 76, -12, -8, 55, 95, -14, -5, 34, 112, -13, -1, 15, 123, -9, 0, 128, 0, 0, -10, 124, 15, -1,
  -14, 113, 34, -5, -15, 96, 56, -9, -13, 77, 77, -13, -9, 56, 96, -15, -5, 34, 113, -14, -1, 15, 124, -10,
  0, 128, 0, 0, -10, 123, 16, -1, -15, 113, 35, -5, -16, 98, 56, -10, -14, 78, 78, -14, -10, 56, 98, -16,
  -5, 35, 113, -15, -1, 16, 123, -10, 0, 128, 0, 0, -11, 124, 17, -2, -16, 113, 36, -5, -17, 98, 57, -10,
  -14, 78, 78, -14, -10, 57, 98, -17, -5, 36, 113, -16, -2, 17, 124, -11, 0, 128, 0, 0, -12, 125, 17, -2,
  -17, 114, 37, -6, -18, 99, 58, -11, -15, 79, 79, -15, -11, 58, 99, -18, -6, 37, 114, -17, -2, 17, 125, -12,
  0, 128, 0, 0, -12, 124, 18, -2, -18, 114, 38, -6, -19, 99, 59, -11, -16, 80, 80, -16, -11, 59, 99, -19,
  -6, 38, 114, -18, -2, 18, 124, -12, 0, 128, 0, 0, -4, 118, 16, -2, -7, 106, 34, -5, -8, 90, 53, -7,
  -8, 72, 72, -8, -7, 53, 90, -8, -5, 34, 106, -7, -2, 16, 118, -4,
]);
const PCR_TREE = new Int8Array([
  8, 0, 4, 1, 2, 2, -1, 0, -2, 0, 2, 3, -3, 0, -4, 0, 8, 4, 4, 5, 2, 6, -5, 0,
  -6, 0, 2, 7, -7, 0, -8, 0, 0, 0,
]);
const HUFF_COEFF_MAP = new Uint8Array([
  13, 14, 11, 0, 1, 15, 16, 18, 2, 17, 3, 4, 19, 20, 5, 6, 21, 22, 7, 8, 9, 10,
]);
const HUFF_RUN_MAP = new Uint8Array([
  10, 13, 11, 12, 0, 1, 2, 3, 14, 8, 15, 16, 4, 5, 6, 7,
]);

// ---- ここから復号器 ----

const FRAME_NONE = -1, FRAME_CURRENT = 0, FRAME_PREVIOUS = 1, FRAME_GOLDEN = 2;
const MB_INTER_NOVEC_PF = 0, MB_INTRA = 1, MB_INTER_DELTA_PF = 2, MB_INTER_V1_PF = 3, MB_INTER_V2_PF = 4,
  MB_INTER_NOVEC_GF = 5, MB_INTER_DELTA_GF = 6, MB_INTER_4V = 7, MB_INTER_V1_GF = 8, MB_INTER_V2_GF = 9;

const B2P = [0, 0, 0, 0, 1, 2]; // ブロックの番号 → 面（Y, U, V）
const B6TO4 = [0, 0, 1, 1, 2, 3]; // ブロックの番号 → 左隣の情報の置き場所

// 係数の位置 → IDCT に渡す配列の中の位置（ジグザグの順を、行と列を入れ替えたもの）
const IDCT_SCANTABLE = Uint8Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
], (x) => (x >> 3) | ((x & 7) << 3));

const HNODE = -1; // ハフマン木の、葉でない節

/** レンジ符号の復号器（vpx_rac）。 */
class RangeDecoder {
  constructor(buf, start, end) {
    if (end - start < 1) throw new VideoError('vp6: a partition is empty');
    this.buf = buf;
    this.end = end;
    this.high = 255;
    this.bits = -16;
    this.code = ((buf[start] << 16) | (buf[start + 1] << 8) | buf[start + 2]) >>> 0; // 配列の外は undefined で、0 として入る
    this.pos = start + 3;
    this.endReached = 0;
  }

  isEnd() {
    if (this.end <= this.pos && this.bits >= 0) this.endReached++;
    return this.endReached > 10;
  }

  renorm() {
    const shift = Math.clz32(this.high) - 24;
    let bits = this.bits + shift;
    let code = (this.code << shift) >>> 0;
    this.high <<= shift;
    if (bits >= 0 && this.pos < this.end) {
      code = (code | (((this.buf[this.pos] << 8) | this.buf[this.pos + 1]) << bits)) >>> 0;
      this.pos += 2;
      bits -= 16;
    }
    this.bits = bits;
    return code;
  }

  /** 確率 prob / 256 で 0 になるビットを読む。 */
  getProb(prob) {
    const code = this.renorm();
    const low = 1 + (((this.high - 1) * prob) >> 8);
    const lowShift = low * 65536;
    if (code >= lowShift) {
      this.high -= low;
      this.code = code - lowShift;
      return 1;
    }
    this.high = low;
    this.code = code;
    return 0;
  }

  /** 確率が半々のビットを読む。 */
  get() {
    const code = this.renorm();
    const low = (this.high + 1) >> 1;
    const lowShift = low * 65536;
    if (code >= lowShift) {
      this.high -= low;
      this.code = code - lowShift;
      return 1;
    }
    this.high = low;
    this.code = code;
    return 0;
  }

  gets(bits) {
    let value = 0;
    while (bits--) value = (value << 1) | this.get();
    return value;
  }

  /** 7 ビットの確率の値（0 にはならない）。 */
  getsNn() {
    return (this.gets(7) << 1) || 1;
  }

  /** 木（[進む数, 確率の番号] の並び。葉は進む数が 0 以下で、値はその符号を変えたもの）をたどる。 */
  getTree(tree, probs, offset) {
    let at = 0;
    while (tree[at] > 0) at += this.getProb(probs[offset + tree[at + 1]]) ? tree[at] * 2 : 2;
    return -tree[at];
  }
}

/** ビット列の読み取り（ハフマン符号の係数用。上位ビットから）。終わりの先は 0 が続く。 */
class BitReader {
  constructor(buf, start, end) {
    this.buf = buf;
    this.pos = start * 8;
    this.end = end * 8;
  }

  left() {
    return this.end - this.pos;
  }

  bit() {
    const p = this.pos++;
    return p < this.end ? (this.buf[p >> 3] >> (7 - (p & 7))) & 1 : 0;
  }

  bits(n) {
    let v = 0;
    while (n--) v = (v << 1) | this.bit();
    return v;
  }

  /** ハフマン木をたどって、記号をひとつ読む。 */
  symbol(tree) {
    let node = tree.root;
    while (tree.sym[node] === HNODE) node = tree.n0[node] + this.bit();
    return tree.sym[node];
  }
}

// 確率のモデルから、ハフマン木を作る（vp6_build_huff_tree と ff_huff_build_tree）。
function buildHuffTree(model, offset, map, size) {
  // まず、モデル（二分木の各節の確率）から、各記号の頻度を出す。count[size + i] は i 番の節の頻度。
  const count = new Int32Array(2 * size);
  count[size] = 256;
  for (let i = 0; i < size - 1; i++) {
    const a = (count[size + i] * model[offset + i]) >> 8;
    const b = (count[size + i] * (255 - model[offset + i])) >> 8;
    count[map[2 * i]] = a || 1;
    count[map[2 * i + 1]] = b || 1;
  }
  // 頻度の小さい順（同じなら記号の大きい順）に並べて、小さいもの 2 つずつをまとめていく。
  const nodes = [];
  for (let i = 0; i < size; i++) nodes.push({ sym: i, n0: -2, count: count[i] });
  nodes.sort((a, b) => (a.count - b.count) * 16 + (b.sym - a.sym));
  let last = size;
  for (let i = 0; i < size * 2 - 2; i += 2) {
    const sum = nodes[i].count + nodes[i + 1].count;
    let j = last;
    for (; j > i + 2; j--) {
      if (sum > nodes[j - 1].count) break;
      nodes[j] = nodes[j - 1];
    }
    nodes[j] = { sym: HNODE, n0: i, count: sum };
    last++;
  }
  return { root: size * 2 - 2, sym: Int8Array.from(nodes, (n) => n.sym), n0: Int8Array.from(nodes, (n) => n.n0) };
}

// ---- 逆 DCT（vp3dsp.c）。type 1 は絵をそのまま書き、type 2 は今の絵に足す。dst は Uint8ClampedArray（0〜255 に丸まる） ----

const xC1S7 = 64277, xC2S6 = 60547, xC3S5 = 54491, xC4S4 = 46341, xC5S3 = 36410, xC6S2 = 25080, xC7S1 = 12785;
const M = (a, b) => Math.imul(a, b) >> 16;

function idct(dst, at, stride, ip, type) {
  for (let i = 0; i < 8; i++) {
    if (ip[i] | ip[8 + i] | ip[16 + i] | ip[24 + i] | ip[32 + i] | ip[40 + i] | ip[48 + i] | ip[56 + i]) {
      const A = M(xC1S7, ip[8 + i]) + M(xC7S1, ip[56 + i]);
      const B = M(xC7S1, ip[8 + i]) - M(xC1S7, ip[56 + i]);
      const C = M(xC3S5, ip[24 + i]) + M(xC5S3, ip[40 + i]);
      const D = M(xC3S5, ip[40 + i]) - M(xC5S3, ip[24 + i]);
      const Ad = M(xC4S4, A - C), Bd = M(xC4S4, B - D);
      const Cd = A + C, Dd = B + D;
      const E = M(xC4S4, ip[i] + ip[32 + i]);
      const F = M(xC4S4, ip[i] - ip[32 + i]);
      const G = M(xC2S6, ip[16 + i]) + M(xC6S2, ip[48 + i]);
      const H = M(xC6S2, ip[16 + i]) - M(xC2S6, ip[48 + i]);
      const Ed = E - G, Gd = E + G;
      const Add = F + Ad, Bdd = Bd - H;
      const Fd = F - Ad, Hd = Bd + H;
      ip[i] = Gd + Cd;
      ip[56 + i] = Gd - Cd;
      ip[8 + i] = Add + Hd;
      ip[16 + i] = Add - Hd;
      ip[24 + i] = Ed + Dd;
      ip[32 + i] = Ed - Dd;
      ip[40 + i] = Fd + Bdd;
      ip[48 + i] = Fd - Bdd;
    }
  }
  for (let i = 0, p = 0; i < 8; i++, p += 8, at++) {
    if (ip[p + 1] | ip[p + 2] | ip[p + 3] | ip[p + 4] | ip[p + 5] | ip[p + 6] | ip[p + 7]) {
      const A = M(xC1S7, ip[p + 1]) + M(xC7S1, ip[p + 7]);
      const B = M(xC7S1, ip[p + 1]) - M(xC1S7, ip[p + 7]);
      const C = M(xC3S5, ip[p + 3]) + M(xC5S3, ip[p + 5]);
      const D = M(xC3S5, ip[p + 5]) - M(xC5S3, ip[p + 3]);
      const Ad = M(xC4S4, A - C), Bd = M(xC4S4, B - D);
      const Cd = A + C, Dd = B + D;
      const bias = type === 1 ? 8 + 16 * 128 : 8;
      const E = M(xC4S4, ip[p] + ip[p + 4]) + bias;
      const F = M(xC4S4, ip[p] - ip[p + 4]) + bias;
      const G = M(xC2S6, ip[p + 2]) + M(xC6S2, ip[p + 6]);
      const H = M(xC6S2, ip[p + 2]) - M(xC2S6, ip[p + 6]);
      const Ed = E - G, Gd = E + G;
      const Add = F + Ad, Bdd = Bd - H;
      const Fd = F - Ad, Hd = Bd + H;
      if (type === 1) {
        dst[at] = (Gd + Cd) >> 4;
        dst[at + 7 * stride] = (Gd - Cd) >> 4;
        dst[at + stride] = (Add + Hd) >> 4;
        dst[at + 2 * stride] = (Add - Hd) >> 4;
        dst[at + 3 * stride] = (Ed + Dd) >> 4;
        dst[at + 4 * stride] = (Ed - Dd) >> 4;
        dst[at + 5 * stride] = (Fd + Bdd) >> 4;
        dst[at + 6 * stride] = (Fd - Bdd) >> 4;
      } else {
        dst[at] += (Gd + Cd) >> 4;
        dst[at + 7 * stride] += (Gd - Cd) >> 4;
        dst[at + stride] += (Add + Hd) >> 4;
        dst[at + 2 * stride] += (Add - Hd) >> 4;
        dst[at + 3 * stride] += (Ed + Dd) >> 4;
        dst[at + 4 * stride] += (Ed - Dd) >> 4;
        dst[at + 5 * stride] += (Fd + Bdd) >> 4;
        dst[at + 6 * stride] += (Fd - Bdd) >> 4;
      }
    } else if (type === 1) {
      const v = 128 + ((xC4S4 * ip[p] + (8 << 16)) >> 20);
      for (let k = 0; k < 8; k++) dst[at + k * stride] = v;
    } else if (ip[p]) {
      const v = (xC4S4 * ip[p] + (8 << 16)) >> 20;
      for (let k = 0; k < 8; k++) dst[at + k * stride] += v;
    }
  }
  ip.fill(0);
}

// 左上の 4×4（のうちの 10 個）にしか係数が無いときの、手を省いた逆 DCT。
function idct10(dst, at, stride, ip, type) {
  for (let i = 0; i < 4; i++) {
    if (ip[i] | ip[8 + i] | ip[16 + i] | ip[24 + i]) {
      const A = M(xC1S7, ip[8 + i]);
      const B = M(xC7S1, ip[8 + i]);
      const C = M(xC3S5, ip[24 + i]);
      const D = -M(xC5S3, ip[24 + i]);
      const Ad = M(xC4S4, A - C), Bd = M(xC4S4, B - D);
      const Cd = A + C, Dd = B + D;
      const E = M(xC4S4, ip[i]);
      const F = E;
      const G = M(xC2S6, ip[16 + i]);
      const H = M(xC6S2, ip[16 + i]);
      const Ed = E - G, Gd = E + G;
      const Add = F + Ad, Bdd = Bd - H;
      const Fd = F - Ad, Hd = Bd + H;
      ip[i] = Gd + Cd;
      ip[56 + i] = Gd - Cd;
      ip[8 + i] = Add + Hd;
      ip[16 + i] = Add - Hd;
      ip[24 + i] = Ed + Dd;
      ip[32 + i] = Ed - Dd;
      ip[40 + i] = Fd + Bdd;
      ip[48 + i] = Fd - Bdd;
    }
  }
  for (let i = 0, p = 0; i < 8; i++, p += 8, at++) {
    if (ip[p] | ip[p + 1] | ip[p + 2] | ip[p + 3]) {
      const A = M(xC1S7, ip[p + 1]);
      const B = M(xC7S1, ip[p + 1]);
      const C = M(xC3S5, ip[p + 3]);
      const D = -M(xC5S3, ip[p + 3]);
      const Ad = M(xC4S4, A - C), Bd = M(xC4S4, B - D);
      const Cd = A + C, Dd = B + D;
      const E = M(xC4S4, ip[p]) + (type === 1 ? 16 * 128 : 0);
      const F = E;
      const G = M(xC2S6, ip[p + 2]);
      const H = M(xC6S2, ip[p + 2]);
      const Ed = E - G + 8, Gd = E + G + 8;
      const Add = F + Ad + 8, Bdd = Bd - H;
      const Fd = F - Ad + 8, Hd = Bd + H;
      if (type === 1) {
        dst[at] = (Gd + Cd) >> 4;
        dst[at + 7 * stride] = (Gd - Cd) >> 4;
        dst[at + stride] = (Add + Hd) >> 4;
        dst[at + 2 * stride] = (Add - Hd) >> 4;
        dst[at + 3 * stride] = (Ed + Dd) >> 4;
        dst[at + 4 * stride] = (Ed - Dd) >> 4;
        dst[at + 5 * stride] = (Fd + Bdd) >> 4;
        dst[at + 6 * stride] = (Fd - Bdd) >> 4;
      } else {
        dst[at] += (Gd + Cd) >> 4;
        dst[at + 7 * stride] += (Gd - Cd) >> 4;
        dst[at + stride] += (Add + Hd) >> 4;
        dst[at + 2 * stride] += (Add - Hd) >> 4;
        dst[at + 3 * stride] += (Ed + Dd) >> 4;
        dst[at + 4 * stride] += (Ed - Dd) >> 4;
        dst[at + 5 * stride] += (Fd + Bdd) >> 4;
        dst[at + 6 * stride] += (Fd - Bdd) >> 4;
      }
    } else if (type === 1) {
      for (let k = 0; k < 8; k++) dst[at + k * stride] = 128;
    }
  }
  ip.fill(0);
}

// ---- 動き補償の部品（vp6.c、vp6dsp.c、h264chroma_template.c） ----

// 8×h の、1/8 画素単位の双一次補間。
function bilinear(dst, to, dstStride, src, from, srcStride, h, x, y) {
  const A = (8 - x) * (8 - y), B = x * (8 - y), C = (8 - x) * y, D = x * y;
  for (let j = 0; j < h; j++, to += dstStride, from += srcStride) {
    if (D) {
      for (let i = 0; i < 8; i++) {
        dst[to + i] = (A * src[from + i] + B * src[from + i + 1] + C * src[from + srcStride + i] + D * src[from + srcStride + i + 1] + 32) >> 6;
      }
    } else if (B + C) {
      const E = B + C, step = C ? srcStride : 1;
      for (let i = 0; i < 8; i++) dst[to + i] = (A * src[from + i] + E * src[from + step + i] + 32) >> 6;
    } else {
      for (let i = 0; i < 8; i++) dst[to + i] = src[from + i];
    }
  }
}

// 縦か横の一方向だけの、4 タップのフィルタ。delta は隣の画素までの距離、weights は BLOCK_COPY_FILTER の中の位置。
function filterHv4(dst, to, dstStride, src, from, srcStride, delta, weights) {
  const w0 = BLOCK_COPY_FILTER[weights], w1 = BLOCK_COPY_FILTER[weights + 1], w2 = BLOCK_COPY_FILTER[weights + 2], w3 = BLOCK_COPY_FILTER[weights + 3];
  for (let j = 0; j < 8; j++, to += dstStride, from += srcStride) {
    for (let i = 0; i < 8; i++) {
      const p = from + i;
      dst[to + i] = (src[p - delta] * w0 + src[p] * w1 + src[p + delta] * w2 + src[p + 2 * delta] * w3 + 64) >> 7;
    }
  }
}

const DIAG_TMP = new Uint8ClampedArray(8 * 11);

// 横に 4 タップ、続けて縦に 4 タップのフィルタ。
function filterDiag4(dst, to, dstStride, src, from, srcStride, hWeights, vWeights) {
  const t = DIAG_TMP;
  const h0 = BLOCK_COPY_FILTER[hWeights], h1 = BLOCK_COPY_FILTER[hWeights + 1], h2 = BLOCK_COPY_FILTER[hWeights + 2], h3 = BLOCK_COPY_FILTER[hWeights + 3];
  const v0 = BLOCK_COPY_FILTER[vWeights], v1 = BLOCK_COPY_FILTER[vWeights + 1], v2 = BLOCK_COPY_FILTER[vWeights + 2], v3 = BLOCK_COPY_FILTER[vWeights + 3];
  from -= srcStride;
  for (let j = 0; j < 11; j++, from += srcStride) {
    for (let i = 0; i < 8; i++) {
      const p = from + i;
      t[j * 8 + i] = (src[p - 1] * h0 + src[p] * h1 + src[p + 1] * h2 + src[p + 2] * h3 + 64) >> 7;
    }
  }
  for (let j = 0; j < 8; j++, to += dstStride) {
    for (let i = 0; i < 8; i++) {
      const p = j * 8 + i;
      dst[to + i] = (t[p] * v0 + t[p + 8] * v1 + t[p + 16] * v2 + t[p + 24] * v3 + 64) >> 7;
    }
  }
}

// 8×8 の、ひとつおきの画素の分散。
function blockVariance(src, from, stride) {
  let sum = 0, squareSum = 0;
  for (let y = 0; y < 8; y += 2, from += 2 * stride) {
    for (let x = 0; x < 8; x += 2) {
      sum += src[from + x];
      squareSum += src[from + x] * src[from + x];
    }
  }
  return (16 * squareSum - sum * sum) >> 8;
}

/**
 * ひとつの絵（色、またはアルファ）の復号の状態（FFmpeg の VP56Context）。
 * アルファ用のときは、輝度にあたる面だけを作る（色差の係数は読み捨てる）。
 */
class Context {
  constructor(alphaOnly) {
    this.bMax = alphaOnly ? 4 : 6; // 絵にするブロックの数
    this.planes = alphaOnly ? 1 : 3;
    this.mbWidth = 0;
    this.mbHeight = 0;
    this.strides = [0, 0, 0];
    this.planeWidth = [0, 0, 0];
    this.planeHeight = [0, 0, 0];
    // フレーム: 面の配列。buffers の 3 枚を使い回す（今の絵、直前の絵、ゴールデンフレーム）
    this.buffers = [];
    this.current = null;
    this.previous = null;
    this.golden = null;
    // フレームの見出しの内容。フレームをまたいで残るものがある
    this.key = false;
    this.quantizer = -1;
    this.dequantDc = 0;
    this.dequantAc = 0;
    this.boundingValues = new Int32Array(256);
    this.subVersion = 0;
    this.filterHeader = 0;
    this.goldenFrame = 0;
    this.deblockFiltering = 0;
    this.filterMode = 0;
    this.sampleVarianceThreshold = 0;
    this.maxVectorLength = 0;
    this.filterSelection = 0;
    this.useHuffman = 0;
    this.huffmanCoeff = false; // 係数がハフマン符号か
    this.interlaced = 0; // インターレース: マクロブロックごとに、1 行おきの 2 枚の絵（フィールド）として符号化できる
    this.ilProb = 0;
    this.ilBlock = 0; // 今のマクロブロックが、フィールドごとの符号化か
    this.c = null; // レンジ符号（見出し、モデル、マクロブロックの種類とベクトル）
    this.ccp = null; // 係数のレンジ符号（別の区画に分かれていなければ c と同じ）
    this.gb = null; // 係数のビット列（ハフマン符号のとき）
    // 確率のモデル（VP56Model）
    this.vectorSig = new Uint8Array(2);
    this.vectorDct = new Uint8Array(2);
    this.vectorPdv = new Uint8Array(2 * 7);
    this.vectorFdv = new Uint8Array(2 * 8);
    this.coeffReorder = new Uint8Array(64);
    this.coeffIndexToPos = new Uint8Array(64);
    this.coeffIndexToIdctSelector = new Uint8Array(64);
    this.coeffDccv = new Uint8Array(2 * 11);
    this.coeffRact = new Uint8Array(2 * 3 * 6 * 11);
    this.coeffDcct = new Uint8Array(2 * 3 * 5);
    this.coeffRunv = new Uint8Array(2 * 14);
    this.mbTypeModel = new Uint8Array(3 * 10 * 10);
    this.mbTypesStats = new Uint8Array(3 * 10 * 2);
    this.dccvTrees = [null, null];
    this.runvTrees = [null, null];
    this.ractTrees = new Array(2 * 3 * 4).fill(null);
    this.nbNull = new Uint32Array(4);
    // マクロブロックごとの情報
    this.mbTypes = null;
    this.mbMvX = null;
    this.mbMvY = null;
    this.mbType = MB_INTER_NOVEC_PF;
    this.candX = new Int16Array(2);
    this.candY = new Int16Array(2);
    this.candidatePos = 0;
    this.vectX = 0;
    this.vectY = 0;
    this.mvX = new Int16Array(6);
    this.mvY = new Int16Array(6);
    // 係数と、DC の予測
    this.blockCoeff = new Int16Array(6 * 64);
    this.blocks = [0, 1, 2, 3, 4, 5].map((b) => this.blockCoeff.subarray(b * 64, b * 64 + 64));
    this.idctSelector = new Int32Array(6);
    this.prevDc = new Int16Array(3 * 3);
    this.leftRef = new Int8Array(4);
    this.leftDc = new Int16Array(4);
    this.leftNotNull = new Uint8Array(4);
    this.aboveRef = null;
    this.aboveDc = null;
    this.aboveNotNull = null;
    this.aboveIdx = new Int32Array(6);
    this.blockOffset = new Int32Array(6);
    // 動き補償の作業用: 12×12 の画素（1 行 16 バイト。フィールドごとのマクロブロックでは 12×24）と、斜めの補間の途中の結果
    this.emu = new Uint8ClampedArray(16 * 24);
    this.tmp = new Uint8ClampedArray(8 * 9);
  }

  // ---- フレームの見出し（vp6_parse_header） ----

  parseHeader(buf, start, end) {
    let p = start;
    if (end - p < 2) throw new VideoError('vp6: the frame is too short');
    const separatedCoeff = buf[p] & 1;
    this.key = !(buf[p] & 0x80);
    this.initDequant((buf[p] >> 1) & 0x3f);
    let coeffOffset = 0, parseFilterInfo = 0, vrtShift = 0;
    let c;
    if (this.key) {
      const subVersion = buf[p + 1] >> 3;
      if (subVersion > 8) throw new VideoError('vp6: unknown version of the bitstream');
      const filterHeader = buf[p + 1] & 6;
      if (separatedCoeff || !filterHeader) {
        if (end - p < 4) throw new VideoError('vp6: the frame is too short');
        coeffOffset = ((buf[p + 2] << 8) | buf[p + 3]) - 2;
        p += 2;
      }
      if (end - p < 7) throw new VideoError('vp6: the frame is too short');
      const rows = buf[p + 2], cols = buf[p + 3]; // 続く 2 バイトは、表示する行数と列数（使わない）
      if (!rows || !cols) throw new VideoError('vp6: the frame size is zero');
      if (rows * cols * 256 > MAX_VIDEO_PIXELS) throw new VideoError(`video frame size ${cols * 16}x${rows * 16} is out of range`);
      this.filterHeader = filterHeader;
      this.interlaced = buf[start + 1] & 1;
      if (!this.mbTypes || cols !== this.mbWidth || rows !== this.mbHeight) this.resize(cols, rows);
      c = new RangeDecoder(buf, p + 6, end);
      c.gets(2);
      parseFilterInfo = filterHeader;
      if (subVersion < 8) vrtShift = 5;
      this.subVersion = subVersion;
      this.goldenFrame = 0;
    } else {
      if (!this.subVersion || !this.mbTypes) throw new VideoError('vp6: an inter frame without a key frame');
      if (separatedCoeff || !this.filterHeader) {
        if (end - p < 3) throw new VideoError('vp6: the frame is too short');
        coeffOffset = ((buf[p + 1] << 8) | buf[p + 2]) - 2;
        p += 2;
      }
      c = new RangeDecoder(buf, p + 1, end);
      this.goldenFrame = c.get();
      if (this.filterHeader) {
        this.deblockFiltering = c.get();
        if (this.deblockFiltering) c.get();
        if (this.subVersion > 7) parseFilterInfo = c.get();
      }
    }
    if (parseFilterInfo) {
      if (c.get()) {
        this.filterMode = 2;
        this.sampleVarianceThreshold = c.gets(5) << vrtShift;
        this.maxVectorLength = 2 << c.gets(3);
      } else if (c.get()) this.filterMode = 1;
      else this.filterMode = 0;
      this.filterSelection = this.subVersion > 7 ? c.gets(4) : 16;
    }
    this.useHuffman = c.get();
    this.c = c;
    this.ccp = c;
    this.huffmanCoeff = false;
    if (coeffOffset) {
      // 係数は別の区画にある。場所は、フレームの中での位置で示される。
      p += coeffOffset;
      if (coeffOffset < 0 || p > end) throw new VideoError('vp6: the coefficient partition is outside the frame');
      if (this.useHuffman) {
        this.huffmanCoeff = true;
        this.gb = new BitReader(buf, p, end);
      } else this.ccp = new RangeDecoder(buf, p, end);
    }
  }

  // 量子化の係数と、ループフィルタの値の表（ff_vp56_init_dequant、ff_vp3dsp_set_bounding_values）。
  initDequant(quantizer) {
    if (this.quantizer !== quantizer) {
      const bv = this.boundingValues, limit = FILTER_THRESHOLD[quantizer];
      bv.fill(0);
      for (let x = 0; x < limit; x++) {
        bv[127 - x] = -x;
        bv[127 + x] = x;
      }
      let value = limit;
      for (let x = limit; x < 128 && value; x++, value--) {
        bv[127 + x] = value;
        bv[127 - x] = -value;
      }
      if (value) bv[255] = value;
    }
    this.quantizer = quantizer;
    this.dequantDc = DC_DEQUANT[quantizer] << 2;
    this.dequantAc = AC_DEQUANT[quantizer] << 2;
  }

  // 絵の大きさが変わった（最初のキーフレームを含む）。参照する絵は捨てる。
  resize(cols, rows) {
    this.mbWidth = cols;
    this.mbHeight = rows;
    const width = cols * 16, height = rows * 16;
    this.strides = [width, width >> 1, width >> 1];
    this.planeWidth = [width, width >> 1, width >> 1];
    this.planeHeight = [height, height >> 1, height >> 1];
    this.buffers = [0, 1, 2].map(() => {
      const frame = [new Uint8ClampedArray(width * height)];
      if (this.planes === 3) frame.push(new Uint8ClampedArray((width * height) >> 2), new Uint8ClampedArray((width * height) >> 2));
      return frame;
    });
    this.current = this.previous = this.golden = null;
    this.mbTypes = new Uint8Array(cols * rows);
    this.mbMvX = new Int16Array(cols * rows);
    this.mbMvY = new Int16Array(cols * rows);
    this.aboveRef = new Int8Array(4 * cols + 6);
    this.aboveDc = new Int16Array(4 * cols + 6);
    this.aboveNotNull = new Uint8Array(4 * cols + 6);
  }

  // ---- 確率のモデル ----

  // vp6_coeff_order_table_init
  coeffOrderTableInit() {
    const toPos = this.coeffIndexToPos;
    toPos[0] = 0;
    let idx = 1;
    for (let i = 0; i < 16; i++) for (let pos = 1; pos < 64; pos++) if (this.coeffReorder[pos] === i) toPos[idx++] = pos;
    let max = 0;
    for (idx = 0; idx < 64; idx++) {
      if (toPos[idx] > max) max = toPos[idx];
      this.coeffIndexToIdctSelector[idx] = this.subVersion > 6 ? max + 1 : max;
    }
  }

  // vp6_default_models_init
  defaultModelsInit() {
    this.vectorDct[0] = 0xa2;
    this.vectorDct[1] = 0xa4;
    this.vectorSig[0] = 0x80;
    this.vectorSig[1] = 0x80;
    this.mbTypesStats.set(DEF_MB_TYPES_STATS);
    this.vectorFdv.set(DEF_FDV_VECTOR_MODEL);
    this.vectorPdv.set(DEF_PDV_VECTOR_MODEL);
    this.coeffRunv.set(DEF_RUNV_COEFF_MODEL);
    this.coeffReorder.set(this.interlaced ? IL_COEFF_REORDER : DEF_COEFF_REORDER);
    this.coeffOrderTableInit();
  }

  // vp56_parse_mb_type_models
  parseMbTypeModels() {
    const c = this.c, stats = this.mbTypesStats, model = this.mbTypeModel;
    for (let ctx = 0; ctx < 3; ctx++) {
      if (c.getProb(174)) {
        const idx = c.gets(4);
        stats.set(PRE_DEF_MB_TYPE_STATS.subarray((idx * 3 + ctx) * 20, (idx * 3 + ctx) * 20 + 20), ctx * 20);
      }
      if (c.getProb(254)) {
        for (let type = 0; type < 10; type++) {
          for (let i = 0; i < 2; i++) {
            if (c.getProb(205)) {
              const sign = c.get();
              let delta = c.getTree(PMBTM_TREE, MB_TYPE_MODEL_MODEL, 0);
              if (!delta) delta = 4 * c.gets(7);
              stats[ctx * 20 + type * 2 + i] += sign ? -delta : delta;
            }
          }
        }
      }
    }
    // 直前のマクロブロックの種類ごとに、種類を読むための確率の表を作る。
    const p = new Int32Array(10);
    for (let ctx = 0; ctx < 3; ctx++) {
      for (let type = 0; type < 10; type++) p[type] = 100 * stats[ctx * 20 + type * 2 + 1];
      for (let type = 0; type < 10; type++) {
        const m = (ctx * 10 + type) * 10;
        const s0 = stats[ctx * 20 + type * 2], s1 = stats[ctx * 20 + type * 2 + 1];
        model[m] = 255 - Math.trunc((255 * s0) / (1 + s0 + s1));
        p[type] = 0; // 同じ種類が続く場合は別に扱うので、重みを 0 にする
        const p02 = p[0] + p[2], p34 = p[3] + p[4], p0234 = p02 + p34;
        const p17 = p[1] + p[7], p56 = p[5] + p[6], p89 = p[8] + p[9], p5689 = p56 + p89, p156789 = p17 + p5689;
        model[m + 1] = 1 + Math.trunc((255 * p0234) / (1 + p0234 + p156789));
        model[m + 2] = 1 + Math.trunc((255 * p02) / (1 + p0234));
        model[m + 3] = 1 + Math.trunc((255 * p17) / (1 + p156789));
        model[m + 4] = 1 + Math.trunc((255 * p[0]) / (1 + p02));
        model[m + 5] = 1 + Math.trunc((255 * p[3]) / (1 + p34));
        model[m + 6] = 1 + Math.trunc((255 * p[1]) / (1 + p17));
        model[m + 7] = 1 + Math.trunc((255 * p56) / (1 + p5689));
        model[m + 8] = 1 + Math.trunc((255 * p[5]) / (1 + p56));
        model[m + 9] = 1 + Math.trunc((255 * p[8]) / (1 + p89));
        p[type] = 100 * s1;
      }
    }
  }

  // vp6_parse_vector_models
  parseVectorModels() {
    const c = this.c;
    for (let comp = 0; comp < 2; comp++) {
      if (c.getProb(SIG_DCT_PCT[comp * 2])) this.vectorDct[comp] = c.getsNn();
      if (c.getProb(SIG_DCT_PCT[comp * 2 + 1])) this.vectorSig[comp] = c.getsNn();
    }
    for (let i = 0; i < 14; i++) if (c.getProb(PDV_PCT[i])) this.vectorPdv[i] = c.getsNn();
    for (let i = 0; i < 16; i++) if (c.getProb(FDV_PCT[i])) this.vectorFdv[i] = c.getsNn();
  }

  // vp6_parse_coeff_models
  parseCoeffModels() {
    const c = this.c;
    const defProb = new Uint8Array(11).fill(0x80);
    for (let pt = 0; pt < 2; pt++) {
      for (let node = 0; node < 11; node++) {
        if (c.getProb(DCCV_PCT[pt * 11 + node])) {
          defProb[node] = c.getsNn();
          this.coeffDccv[pt * 11 + node] = defProb[node];
        } else if (this.key) this.coeffDccv[pt * 11 + node] = defProb[node];
      }
    }
    if (c.get()) {
      for (let pos = 1; pos < 64; pos++) if (c.getProb(COEFF_REORDER_PCT[pos])) this.coeffReorder[pos] = c.gets(4);
      this.coeffOrderTableInit();
    }
    for (let i = 0; i < 28; i++) if (c.getProb(RUNV_PCT[i])) this.coeffRunv[i] = c.getsNn();
    for (let ct = 0; ct < 3; ct++) {
      for (let pt = 0; pt < 2; pt++) {
        for (let cg = 0; cg < 6; cg++) {
          for (let node = 0; node < 11; node++) {
            const at = ((pt * 3 + ct) * 6 + cg) * 11 + node;
            if (c.getProb(RACT_PCT[((ct * 2 + pt) * 6 + cg) * 11 + node])) {
              defProb[node] = c.getsNn();
              this.coeffRact[at] = defProb[node];
            } else if (this.key) this.coeffRact[at] = defProb[node];
          }
        }
      }
    }
    if (this.useHuffman) {
      for (let pt = 0; pt < 2; pt++) {
        this.dccvTrees[pt] = buildHuffTree(this.coeffDccv, pt * 11, HUFF_COEFF_MAP, 12);
        this.runvTrees[pt] = buildHuffTree(this.coeffRunv, pt * 14, HUFF_RUN_MAP, 9);
        for (let ct = 0; ct < 3; ct++) {
          for (let cg = 0; cg < 4; cg++) {
            this.ractTrees[(pt * 3 + ct) * 4 + cg] = buildHuffTree(this.coeffRact, ((pt * 3 + ct) * 6 + cg) * 11, HUFF_COEFF_MAP, 12);
          }
        }
      }
      this.nbNull.fill(0);
    } else {
      // DC の符号の種類の確率は、DC の値の確率の一次式で決まる。
      for (let pt = 0; pt < 2; pt++) {
        for (let ctx = 0; ctx < 3; ctx++) {
          for (let node = 0; node < 5; node++) {
            const v = ((this.coeffDccv[pt * 11 + node] * DCCV_LC[(ctx * 5 + node) * 2] + 128) >> 8) + DCCV_LC[(ctx * 5 + node) * 2 + 1];
            this.coeffDcct[(pt * 3 + ctx) * 5 + node] = Math.min(Math.max(v, 1), 255);
          }
        }
      }
    }
  }

  // ---- マクロブロックの種類と動きベクトル ----

  // 周りのマクロブロックから、動きベクトルの候補を 2 つまで集める（vp56_get_vectors_predictors）。
  vectorsPredictors(row, col, refFrame) {
    let nb = 0;
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    for (let pos = 0; pos < 12; pos++) {
      const mx = col + CANDIDATE_PREDICTOR_POS[pos * 2], my = row + CANDIDATE_PREDICTOR_POS[pos * 2 + 1];
      if (mx < 0 || mx >= this.mbWidth || my < 0 || my >= this.mbHeight) continue;
      const offset = mx + this.mbWidth * my;
      if (REFERENCE_FRAME[this.mbTypes[offset]] !== refFrame) continue;
      const x = this.mbMvX[offset], y = this.mbMvY[offset];
      if ((x === x0 && y === y0) || (x === 0 && y === 0)) continue;
      if (nb === 0) [x0, y0] = [x, y];
      else [x1, y1] = [x, y];
      if (++nb > 1) {
        nb = -1;
        break;
      }
      this.candidatePos = pos;
    }
    this.candX[0] = x0;
    this.candY[0] = y0;
    this.candX[1] = x1;
    this.candY[1] = y1;
    return nb + 1;
  }

  // 動きベクトルの差分を読んで、this.vectX / vectY に入れる（vp6_parse_vector_adjustment）。
  parseVectorAdjustment() {
    const c = this.c;
    let x = 0, y = 0;
    if (this.candidatePos < 2) {
      x = this.candX[0];
      y = this.candY[0];
    }
    for (let comp = 0; comp < 2; comp++) {
      let delta = 0;
      if (c.getProb(this.vectorDct[comp])) {
        const fdv = comp * 8;
        delta |= c.getProb(this.vectorFdv[fdv]);
        delta |= c.getProb(this.vectorFdv[fdv + 1]) << 1;
        delta |= c.getProb(this.vectorFdv[fdv + 2]) << 2;
        delta |= c.getProb(this.vectorFdv[fdv + 7]) << 7;
        delta |= c.getProb(this.vectorFdv[fdv + 6]) << 6;
        delta |= c.getProb(this.vectorFdv[fdv + 5]) << 5;
        delta |= c.getProb(this.vectorFdv[fdv + 4]) << 4;
        if (delta & 0xf0) delta |= c.getProb(this.vectorFdv[fdv + 3]) << 3;
        else delta |= 8;
      } else delta = c.getTree(PVA_TREE, this.vectorPdv, comp * 7);
      if (delta && c.getProb(this.vectorSig[comp])) delta = -delta;
      if (!comp) x += delta;
      else y += delta;
    }
    this.vectX = (x << 16) >> 16;
    this.vectY = (y << 16) >> 16;
  }

  // ブロックごとにベクトルを持つマクロブロック（vp56_decode_4mv）。
  decode4mv(row, col) {
    const c = this.c;
    const type = [0, 0, 0, 0];
    for (let b = 0; b < 4; b++) {
      type[b] = c.gets(2);
      if (type[b]) type[b]++; // 0, 2, 3, 4 のどれか
    }
    let sumX = 0, sumY = 0;
    for (let b = 0; b < 4; b++) {
      switch (type[b]) {
        case MB_INTER_NOVEC_PF:
          this.mvX[b] = this.mvY[b] = 0;
          break;
        case MB_INTER_DELTA_PF:
          this.parseVectorAdjustment();
          this.mvX[b] = this.vectX;
          this.mvY[b] = this.vectY;
          break;
        case MB_INTER_V1_PF:
          this.mvX[b] = this.candX[0];
          this.mvY[b] = this.candY[0];
          break;
        default: // MB_INTER_V2_PF
          this.mvX[b] = this.candX[1];
          this.mvY[b] = this.candY[1];
          break;
      }
      sumX = ((sumX + this.mvX[b]) << 16) >> 16;
      sumY = ((sumY + this.mvY[b]) << 16) >> 16;
    }
    // 周りの予測に使うのは、最後のブロックのベクトル
    this.mbMvX[row * this.mbWidth + col] = this.mvX[3];
    this.mbMvY[row * this.mbWidth + col] = this.mvY[3];
    // 色差のベクトルは、輝度の 4 つの平均
    this.mvX[4] = this.mvX[5] = sumX > 0 ? (sumX + 2) >> 2 : (sumX + 1) >> 2;
    this.mvY[4] = this.mvY[5] = sumY > 0 ? (sumY + 2) >> 2 : (sumY + 1) >> 2;
  }

  // マクロブロックの種類とベクトルを読む（vp56_parse_mb_type、vp56_decode_mv）。
  decodeMv(row, col) {
    const c = this.c;
    const ctx = this.vectorsPredictors(row, col, FRAME_PREVIOUS);
    const model = (ctx * 10 + this.mbType) * 10;
    if (!c.getProb(this.mbTypeModel[model])) this.mbType = c.getTree(PMBT_TREE, this.mbTypeModel, model);
    const type = this.mbType;
    this.mbTypes[row * this.mbWidth + col] = type;
    let x = 0, y = 0;
    switch (type) {
      case MB_INTER_V1_PF:
        x = this.candX[0];
        y = this.candY[0];
        break;
      case MB_INTER_V2_PF:
        x = this.candX[1];
        y = this.candY[1];
        break;
      case MB_INTER_V1_GF:
        this.vectorsPredictors(row, col, FRAME_GOLDEN);
        x = this.candX[0];
        y = this.candY[0];
        break;
      case MB_INTER_V2_GF:
        this.vectorsPredictors(row, col, FRAME_GOLDEN);
        x = this.candX[1];
        y = this.candY[1];
        break;
      case MB_INTER_DELTA_PF:
        this.parseVectorAdjustment();
        x = this.vectX;
        y = this.vectY;
        break;
      case MB_INTER_DELTA_GF:
        this.vectorsPredictors(row, col, FRAME_GOLDEN);
        this.parseVectorAdjustment();
        x = this.vectX;
        y = this.vectY;
        break;
      case MB_INTER_4V:
        this.decode4mv(row, col);
        return type;
      default:
        break;
    }
    this.mbMvX[row * this.mbWidth + col] = x;
    this.mbMvY[row * this.mbWidth + col] = y;
    this.mvX.fill(x);
    this.mvY.fill(y);
    return type;
  }

  // ---- 係数 ----

  // レンジ符号の係数（vp6_parse_coeff）。
  parseCoeff() {
    const c = this.ccp;
    if (c.isEnd()) throw new VideoError('vp6: the coefficient data ended early');
    const ract = this.coeffRact, runv = this.coeffRunv;
    let pt = 0; // 面の種類（0: 輝度、1: 色差）
    for (let b = 0; b < 6; b++) {
      let ct = 1; // 直前の符号の種類
      let run = 1;
      if (b > 3) pt = 1;
      const left = B6TO4[b], above = this.aboveIdx[b];
      const ctx = this.leftNotNull[left] + this.aboveNotNull[above];
      let model1 = this.coeffDccv, at1 = pt * 11;
      let model2 = this.coeffDcct, at2 = (pt * 3 + ctx) * 5;
      const block = this.blocks[b];
      let coeffIdx = 0;
      for (;;) {
        if ((coeffIdx > 1 && ct === 0) || c.getProb(model2[at2])) {
          // 係数
          let coeff;
          if (c.getProb(model2[at2 + 2])) {
            if (c.getProb(model2[at2 + 3])) {
              const idx = c.getTree(PC_TREE, model1, at1);
              coeff = COEFF_BIAS[idx + 5];
              for (let i = COEFF_BIT_LENGTH[idx]; i >= 0; i--) coeff += c.getProb(COEFF_PARSE_TABLE[idx * 11 + i]) << i;
            } else if (c.getProb(model2[at2 + 4])) coeff = 3 + c.getProb(model1[at1 + 5]);
            else coeff = 2;
            ct = 2;
          } else {
            ct = 1;
            coeff = 1;
          }
          if (c.get()) coeff = -coeff;
          if (coeffIdx) coeff *= this.dequantAc;
          block[IDCT_SCANTABLE[this.coeffIndexToPos[coeffIdx]]] = coeff;
          run = 1;
        } else {
          // 0 の連続
          ct = 0;
          if (coeffIdx > 0) {
            if (!c.getProb(model2[at2 + 1])) break;
            const at3 = coeffIdx >= 6 ? 14 : 0;
            run = c.getTree(PCR_TREE, runv, at3);
            if (!run) {
              run = 9;
              for (let i = 0; i < 6; i++) run += c.getProb(runv[at3 + i + 8]) << i;
            }
          }
        }
        coeffIdx += run;
        if (coeffIdx >= 64) break;
        model1 = model2 = ract;
        at1 = at2 = ((pt * 3 + ct) * 6 + COEFF_GROUPS[coeffIdx]) * 11;
      }
      this.leftNotNull[left] = this.aboveNotNull[above] = block[0] ? 1 : 0;
      this.idctSelector[b] = this.coeffIndexToIdctSelector[Math.min(coeffIdx, 63)];
    }
  }

  // DC か AC が 0 のブロックが続く数（vp6_get_nb_null）。
  getNbNull() {
    const gb = this.gb;
    let val = gb.bits(2);
    if (val === 2) val += gb.bits(2);
    else if (val === 3) {
      val = gb.bit() << 2;
      val = 6 + val + gb.bits(2 + val);
    }
    return val;
  }

  // ハフマン符号の係数（vp6_parse_coeff_huffman）。
  parseCoeffHuffman() {
    const gb = this.gb, nbNull = this.nbNull;
    let pt = 0;
    for (let b = 0; b < 6; b++) {
      let ct = 0;
      if (b > 3) pt = 1;
      let tree = this.dccvTrees[pt];
      const block = this.blocks[b];
      let coeffIdx = 0;
      for (;;) {
        let run = 1;
        if (coeffIdx < 2 && nbNull[coeffIdx * 2 + pt]) {
          nbNull[coeffIdx * 2 + pt]--;
          if (coeffIdx) break;
        } else {
          if (gb.left() <= 0) throw new VideoError('vp6: the coefficient data ended early');
          const coeff = gb.symbol(tree);
          if (coeff === 0) {
            if (coeffIdx) {
              run += gb.symbol(this.runvTrees[coeffIdx >= 6 ? 1 : 0]);
              if (run >= 9) run += gb.bits(6);
            } else nbNull[pt] = this.getNbNull();
            ct = 0;
          } else if (coeff === 11) {
            // ブロックの終わり
            if (coeffIdx === 1) nbNull[2 + pt] = this.getNbNull();
            break;
          } else {
            let coeff2 = COEFF_BIAS[coeff];
            if (coeff > 4) coeff2 += gb.bits(coeff <= 9 ? coeff - 4 : 11);
            ct = 1 + (coeff2 > 1 ? 1 : 0);
            if (gb.bit()) coeff2 = -coeff2;
            if (coeffIdx) coeff2 *= this.dequantAc;
            block[IDCT_SCANTABLE[this.coeffIndexToPos[coeffIdx]]] = coeff2;
          }
        }
        coeffIdx += run;
        if (coeffIdx >= 64) break;
        tree = this.ractTrees[(pt * 3 + ct) * 4 + Math.min(COEFF_GROUPS[coeffIdx], 3)];
      }
      this.idctSelector[b] = this.coeffIndexToIdctSelector[Math.min(coeffIdx, 63)];
    }
  }

  // DC を、左と上のブロックから予測した値に足す（vp56_add_predictors_dc）。
  addPredictorsDc(refFrame) {
    for (let b = 0; b < 6; b++) {
      const above = this.aboveIdx[b], left = B6TO4[b];
      let count = 0, dc = 0;
      if (refFrame === this.leftRef[left]) {
        dc += this.leftDc[left];
        count++;
      }
      if (refFrame === this.aboveRef[above]) {
        dc += this.aboveDc[above];
        count++;
      }
      if (count === 0) dc = this.prevDc[B2P[b] * 3 + refFrame];
      else if (count === 2) dc = Math.trunc(dc / 2);
      const block = this.blocks[b];
      block[0] += dc;
      this.prevDc[B2P[b] * 3 + refFrame] = block[0];
      this.aboveDc[above] = block[0];
      this.aboveRef[above] = refFrame;
      this.leftDc[left] = block[0];
      this.leftRef[left] = refFrame;
      block[0] *= this.dequantDc;
    }
  }

  // ---- 動き補償 ----

  // 作業用の画素（1 行が stride バイトの 12×12）にかける、ブロックの境目のフィルタ（vp56_deblock_filter、vp3 のループフィルタ）。
  deblock(stride, dx, dy) {
    const yuv = this.emu, bv = this.boundingValues;
    if (dx) {
      for (let i = 0, p = 10 - dx; i < 12; i++, p += stride) {
        const v = bv[127 + ((yuv[p - 2] - yuv[p + 1] + (yuv[p] - yuv[p - 1]) * 3 + 4) >> 3)];
        yuv[p - 1] += v;
        yuv[p] -= v;
      }
    }
    if (dy) {
      for (let i = 0, p = stride * (10 - dy); i < 12; i++, p++) {
        const v = bv[127 + ((yuv[p - 2 * stride] - yuv[p + stride] + (yuv[p] - yuv[p - stride]) * 3 + 4) >> 3)];
        yuv[p - stride] += v;
        yuv[p] -= v;
      }
    }
  }

  // 端数のあるベクトルの補間（vp6_filter）。offset1 は整数部分の位置、offset2 は端数の向きに 1 画素ずれた位置。
  filter(dst, to, dstStride, src, offset1, offset2, stride, mvx, mvy, mask, luma) {
    let filter4 = 0;
    let x8 = mvx & mask, y8 = mvy & mask;
    if (luma) {
      x8 *= 2;
      y8 *= 2;
      filter4 = this.filterMode;
      if (filter4 === 2) {
        if (this.maxVectorLength && (Math.abs(mvx) > this.maxVectorLength || Math.abs(mvy) > this.maxVectorLength)) filter4 = 0;
        else if (this.sampleVarianceThreshold && blockVariance(src, offset1, stride) < this.sampleVarianceThreshold) filter4 = 0;
      }
    }
    if (offset2 < offset1) offset1 = offset2;
    const diagonal = offset1 + ((mvx ^ mvy) >> 31);
    if (filter4) {
      const select = this.filterSelection * 32;
      if (!y8) filterHv4(dst, to, dstStride, src, offset1, stride, 1, select + x8 * 4);
      else if (!x8) filterHv4(dst, to, dstStride, src, offset1, stride, stride, select + y8 * 4);
      else filterDiag4(dst, to, dstStride, src, diagonal, stride, select + x8 * 4, select + y8 * 4);
    } else if (!x8 || !y8) bilinear(dst, to, dstStride, src, offset1, stride, 8, x8, y8);
    else {
      bilinear(this.tmp, 0, 8, src, diagonal, stride, 9, x8, 0);
      bilinear(dst, to, dstStride, this.tmp, 0, 8, 8, 0, y8);
    }
  }

  // 参照する絵からブロック b を持ってくる（vp56_mc）。x, y は、輝度の面でのブロックの位置。
  // stride は、書き込む側の 1 行の長さ（フィールドごとのマクロブロックの輝度では、面の 2 倍。1 行おきに読み書きする）。
  mc(b, plane, ref, stride, x, y) {
    const dst = this.current[plane], to = this.blockOffset[b], refStride = this.strides[plane];
    const div = b < 4 ? 4 : 8, mask = div - 1;
    const mvx = this.mvX[b], mvy = this.mvY[b];
    const dx = Math.trunc(mvx / div), dy = Math.trunc(mvy / div);
    if (b >= 4) {
      x >>= 1;
      y >>= 1;
    }
    x += dx - 2;
    y += dy - 2;
    const width = this.planeWidth[plane], height = this.planeHeight[plane];
    let src = ref, srcStride = stride, from = to + dy * stride + dx;
    const field = this.interlaced && this.ilBlock;
    if (field || this.deblockFiltering || x < 0 || x + 12 >= width || y < 0 || y + 12 >= height) {
      // 周りの 2 画素を含む 12×12 を、作業用に写す。絵の外は、端の画素を延ばす。
      // フィールドごとのマクロブロックでは、2 行上から 12×24 を写して、輝度は 1 行おきに使う（色差は、4 行目から続けて使う）。
      const emu = this.emu, rows = field ? 24 : 12, top = field ? y - 2 : y;
      for (let j = 0; j < rows; j++) {
        const line = Math.min(Math.max(top + j, 0), height - 1) * refStride;
        for (let i = 0; i < 12; i++) emu[j * 16 + i] = ref[line + Math.min(Math.max(x + i, 0), width - 1)];
      }
      src = emu;
      srcStride = stride === refStride ? 16 : 32;
      from = 2 + (field ? 4 : 2) * 16;
      if (this.deblockFiltering) this.deblock(srcStride, dx & 7, dy & 7);
    }
    let overlap = 0;
    if (mvx & mask) overlap += mvx > 0 ? 1 : -1;
    if (mvy & mask) overlap += mvy > 0 ? srcStride : -srcStride;
    if (overlap) this.filter(dst, to, stride, src, from, from + overlap, srcStride, mvx, mvy, mask, b < 4);
    else for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) dst[to + j * stride + i] = src[from + j * srcStride + i];
  }

  // ---- マクロブロックを絵にする（vp56_render_mb） ----

  renderMb(row, col, type) {
    const refFrame = REFERENCE_FRAME[type];
    this.addPredictorsDc(refFrame);
    const ref = refFrame === FRAME_PREVIOUS ? this.previous : refFrame === FRAME_GOLDEN ? this.golden : this.current;
    if (!ref) throw new VideoError('vp6: the reference frame is missing');
    // フィールドごとのマクロブロック: 輝度の上の 2 ブロックが偶数行、下の 2 ブロックが奇数行になる。
    const field = this.interlaced && this.ilBlock;
    if (field) {
      this.blockOffset[2] -= this.strides[0] * 7;
      this.blockOffset[3] -= this.strides[0] * 7;
    }
    for (let b = 0; b < this.bMax; b++) {
      const plane = B2P[b], stride = field && plane === 0 ? this.strides[0] * 2 : this.strides[plane], to = this.blockOffset[b];
      const dst = this.current[plane], block = this.blocks[b], selector = this.idctSelector[b];
      if (type === MB_INTRA) {
        if (selector > 10 || selector === 1) idct(dst, to, stride, block, 1);
        else idct10(dst, to, stride, block, 1);
        continue;
      }
      if (type === MB_INTER_NOVEC_PF || type === MB_INTER_NOVEC_GF) {
        const from = ref[plane];
        for (let j = 0, p = to; j < 8; j++, p += stride) for (let i = 0; i < 8; i++) dst[p + i] = from[p + i];
      } else this.mc(b, plane, ref[plane], stride, 16 * col + (b === 1 || b === 3 ? 8 : 0), 16 * row + (b === 2 || b === 3 ? (field ? 1 : 8) : 0));
      if (selector > 10) idct(dst, to, stride, block, 2);
      else if (selector > 1) idct10(dst, to, stride, block, 2);
      else {
        const dc = (block[0] + 15) >> 5;
        for (let j = 0, p = to; j < 8; j++, p += stride) for (let i = 0; i < 8; i++) dst[p + i] += dc;
        block[0] = 0;
      }
    }
    if (this.bMax < 6) this.blockCoeff.fill(0, 4 * 64); // 絵にしなかった色差の係数を消す
    if (field) {
      this.blockOffset[2] += this.strides[0] * 7;
      this.blockOffset[3] += this.strides[0] * 7;
    }
  }

  // ---- フレーム全体（ff_vp56_decode_mbs） ----

  decodeMbs() {
    if (this.key) {
      this.defaultModelsInit();
      this.mbTypes.fill(MB_INTRA);
    } else {
      this.parseMbTypeModels();
      this.parseVectorModels();
      this.mbType = MB_INTER_NOVEC_PF;
    }
    this.parseCoeffModels();
    if (this.interlaced) this.ilProb = this.c.gets(8);

    this.prevDc.fill(0);
    this.prevDc[1 * 3 + FRAME_CURRENT] = 128;
    this.prevDc[2 * 3 + FRAME_CURRENT] = 128;
    this.aboveRef.fill(FRAME_NONE);
    this.aboveDc.fill(0);
    this.aboveNotNull.fill(0);
    this.aboveRef[2 * this.mbWidth + 2] = FRAME_CURRENT;
    this.aboveRef[3 * this.mbWidth + 4] = FRAME_CURRENT;

    const strideY = this.strides[0], strideUV = this.strides[1];
    const offset = this.blockOffset, aboveIdx = this.aboveIdx;
    for (let row = 0; row < this.mbHeight; row++) {
      this.leftRef.fill(FRAME_NONE);
      this.leftDc.fill(0);
      this.leftNotNull.fill(0);
      aboveIdx[0] = aboveIdx[2] = 1;
      aboveIdx[1] = aboveIdx[3] = 2;
      aboveIdx[4] = 2 * this.mbWidth + 2 + 1;
      aboveIdx[5] = 3 * this.mbWidth + 4 + 1;
      offset[0] = row * 16 * strideY;
      offset[2] = offset[0] + 8 * strideY;
      offset[1] = offset[0] + 8;
      offset[3] = offset[2] + 8;
      offset[4] = offset[5] = row * 8 * strideUV;
      for (let col = 0; col < this.mbWidth; col++) {
        if (this.interlaced) {
          // フィールドごとの符号化かどうか。確率は、左のマクロブロックがどちらだったかで変わる。
          let prob = this.ilProb;
          if (col > 0) prob += this.ilBlock ? -(prob >> 1) : (256 - prob) >> 1;
          this.ilBlock = this.c.getProb(prob);
        }
        const type = this.key ? MB_INTRA : this.decodeMv(row, col);
        if (this.huffmanCoeff) this.parseCoeffHuffman();
        else this.parseCoeff();
        this.renderMb(row, col, type);
        for (let y = 0; y < 4; y++) {
          aboveIdx[y] += 2;
          offset[y] += 16;
        }
        for (let uv = 4; uv < 6; uv++) {
          aboveIdx[uv] += 1;
          offset[uv] += 8;
        }
      }
    }
  }

  /** buf の start〜end にある 1 フレームを復号して、面の配列を返す。 */
  decodeFrame(buf, start, end) {
    this.parseHeader(buf, start, end);
    this.current = this.buffers.find((frame) => frame !== this.previous && frame !== this.golden);
    this.decodeMbs();
    if (this.key || this.goldenFrame) this.golden = this.current;
    this.previous = this.current;
    return this.current;
  }
}

/**
 * VP6 の復号器。フレームを順に decode に渡す（差分フレームは、前のフレームの結果を使う）。
 * アルファ付き（FLV の CodecID 5）は、色とアルファが別々の VP6 のストリームになっていて、アルファは輝度の面に入っている。
 */
export class VP6Decoder {
  /** @param {boolean} [alpha] アルファ付きのストリームか */
  constructor(alpha = false) {
    this.color = new Context(false);
    this.alpha = alpha ? new Context(true) : null;
  }

  /**
   * @param {Uint8Array} data  VP6 のフレーム。アルファ付きなら、色のデータの長さ（3 バイト）、色のデータ、アルファのデータ
   * @returns {{ width: number, height: number, stride: number, y: Uint8ClampedArray, cb: Uint8ClampedArray, cr: Uint8ClampedArray,
   *   alpha: Uint8ClampedArray | null }}  width と height は符号化された大きさ（16 の倍数。表示する範囲は、入れ物の側が決める）。
   *   輝度とアルファは 1 行 stride バイト、色差は stride / 2 バイト。配列は、後の decode で書き換わる
   */
  decode(data) {
    const { color, alpha } = this;
    let start = 0, alphaStart = data.length;
    if (alpha) {
      if (data.length < 3) throw new VideoError('vp6: the frame is too short');
      start = 3;
      alphaStart = start + ((data[0] << 16) | (data[1] << 8) | data[2]);
      if (alphaStart > data.length) throw new VideoError('vp6: the alpha data is outside the frame');
    }
    const { mbWidth, mbHeight } = color;
    const [y, cb, cr] = color.decodeFrame(data, start, alphaStart);
    let alphaPlane = null;
    if (alpha) {
      // 色の大きさが変わったら、アルファも最初からやり直す。アルファの大きさは、色と同じでなければならない。
      if (mbWidth && (color.mbWidth !== mbWidth || color.mbHeight !== mbHeight)) this.alpha = new Context(true);
      [alphaPlane] = this.alpha.decodeFrame(data, alphaStart, data.length);
      if (this.alpha.mbWidth !== color.mbWidth || this.alpha.mbHeight !== color.mbHeight) throw new VideoError('vp6: the alpha plane has a different size');
    }
    return { width: color.mbWidth * 16, height: color.mbHeight * 16, stride: color.mbWidth * 16, y, cb, cr, alpha: alphaPlane };
  }
}

/** テスト用のストリームを作る道具（tools/mkvp6.js）が使う、内部の部品。 */
export const internals = { RangeDecoder, PVA_TREE, PC_TREE, PCR_TREE, PMBT_TREE };
