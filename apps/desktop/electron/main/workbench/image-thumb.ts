import { readFileSync, statSync } from "node:fs";
import { nativeImage } from "electron";

/**
 * 图片缩略图（Composer 芯片 / 消息气泡 / hover 预览共用）。
 *
 * 用 Electron 内置 nativeImage：按真实编码解码（扩展名伪造也能识别），
 * 等比缩到长边 ≤ THUMB_MAX_EDGE，输出 JPEG dataURL。小图（< INLINE_MAX_BYTES）
 * 不压缩直接原样内联，省一次编解码。
 *
 * 与 fs:read 不同：不按项目目录设防——附件可以来自系统任意位置
 * （文件选择器 / 粘贴暂存目录），渲染进程本来就没有文件系统权限，
 * 读取范围由调用方传入的路径决定。
 */

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const INLINE_MAX_BYTES = 150 * 1024;
const THUMB_MAX_EDGE = 512;
const THUMB_JPEG_QUALITY = 80;

export function imageMimeOf(path: string): string | undefined {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? IMAGE_MIME[lower.slice(dot)] : undefined;
}

/** 读图并返回 dataURL；非图片/超限/解码失败返回 undefined（调用方降级为图标芯片）。 */
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
