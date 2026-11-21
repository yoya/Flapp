// フィルタを外した版。画素は変えずに返す（フィルタは掛からない）。
export function applyFilters(rgba) {
  return { rgba, unsupported: [] };
}
