/**
 * T5.1 三栏键盘焦点循环（逻辑层，纯 DOM，不劫持裸 Tab）。
 *
 * 约定：三个区域容器带 `data-col-region="left|center|right"` 且 `tabIndex={-1}`，
 * 可被程序化 focus；进入某栏后原生 Tab 在栏内遍历。
 * 快捷键在 App 层绑定：Ctrl+Tab 前进 / Ctrl+Shift+Tab 后退 / Alt+1·2·3 直达。
 */

export type ColumnRegion = "left" | "center" | "right";

const ORDER: ColumnRegion[] = ["left", "center", "right"];

function regionEl(name: ColumnRegion): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-col-region="${name}"]`);
}

/** 当前焦点所在区域（含其子元素）；不在任何区域时返回 null */
function currentRegion(): ColumnRegion | null {
  const active = document.activeElement;
  const el = active?.closest?.("[data-col-region]") as HTMLElement | null;
  const name = el?.getAttribute("data-col-region");
  return name === "left" || name === "center" || name === "right" ? name : null;
}

export function focusColumn(name: ColumnRegion): void {
  regionEl(name)?.focus();
}

/** 在可见区域间循环（跳过尚未挂载/不可见的栏，如右栏收起时） */
export function cycleColumnFocus(dir: 1 | -1): void {
  const visible = ORDER.filter((n) => {
    const el = regionEl(n);
    return el && el.offsetParent !== null; // 未挂载/hidden → offsetParent 为 null
  });
  if (visible.length === 0) return;
  const cur = currentRegion();
  let idx = cur ? visible.indexOf(cur) : -1;
  idx = idx < 0 ? 0 : (idx + dir + visible.length) % visible.length;
  focusColumn(visible[idx]);
}
