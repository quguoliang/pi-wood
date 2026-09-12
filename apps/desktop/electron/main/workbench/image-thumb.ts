import { readFileSync, statSync } from "node:fs";
import { nativeImage } from "electron";
import { imageMimeOf } from "@pi-wood/ipc-schema";

/**
 * 图片读取（Composer 芯片 / 消息气泡 / hover 预览共用缩略图；右栏预览用原图）。
 *
 * 用 Electron 内置 nativeImage：按真实编码解码（扩展名伪造也能识别），
 * 等比缩到长边 ≤ THUMB_MAX_EDGE，输出 JPEG dataURL。小图（< INLINE_MAX_BYTES）
 * 不压缩直接原样内联，省一次编解码。
 *
 * 与 fs:read 不同：不按项目目录设防——附件可以来自系统任意位置
 * （文件选择器 / 粘贴暂存目录），渲染进程本来就没有文件系统权限，
 * 读取范围由调用方传入的路径决定。
 *
 * 「哪些扩展名算图片」由 @pi-wood/ipc-schema 单一持有（IMAGE_MIME / imageMimeOf）：
 * 渲染层判定「该走图片视图还是文本编辑器」用的是同一份清单，两处不能各留一份。
 */

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const INLINE_MAX_BYTES = 150 * 1024;
const THUMB_MAX_EDGE = 512;
const THUMB_JPEG_QUALITY = 80;

/** 原图预览：超过这个体积就不原样内联了（base64 后还要膨胀 ~33%，IPC 一次几十 MB 会卡住渲染） */
const MAX_PREVIEW_INLINE_BYTES = 8 * 1024 * 1024;

export { imageMimeOf };

/** 读图并返回小尺寸 dataURL；非图片/超限/解码失败返回 undefined（调用方降级为图标芯片）。 */
export function readImageThumb(path: string): string | undefined {
  const mime = imageMimeOf(path);
  if (!mime) return undefined;
  let buf: Buffer;
  try {
    const st = statSync(path);
    if (st.size > MAX_SOURCE_BYTES) return undefined;
    buf = readFileSync(path);
  } catch {
    return undefined;
  }
  if (buf.length < INLINE_MAX_BYTES) return `data:${mime};base64,${buf.toString("base64")}`;
  try {
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return undefined;
    const { width, height } = img.getSize();
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(width, height));
    const resized =
      scale < 1 ? img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }) : img;
    const jpeg = resized.toJPEG(THUMB_JPEG_QUALITY);
    return jpeg.length > 0 ? `data:image/jpeg;base64,${jpeg.toString("base64")}` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 读图并返回**原尺寸** dataURL（右栏图片预览）。
 *
 * 刻意不重编码：截图类 PNG 一重编码就糊，而预览的价值全在「看得清」。
 * 因此这里直接内联原始字节，只在超过 MAX_PREVIEW_INLINE_BYTES 时降级为缩略图
 * ——**降级而不是返回 undefined**：大图给一张糊的预览，好过点了文件没有任何反馈。
 */
export function readImagePreview(path: string): string | undefined {
  const mime = imageMimeOf(path);
  if (!mime) return undefined;
  try {
    const st = statSync(path);
    if (st.size === 0) return undefined;
    if (st.size > MAX_PREVIEW_INLINE_BYTES) return readImageThumb(path);
    return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
  } catch {
    return undefined;
  }
}

