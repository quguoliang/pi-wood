import assert from "node:assert/strict";
import { test } from "node:test";
import { FS_IMAGE_CHANNEL, FS_THUMB_CHANNEL, IMAGE_MIME, imageMimeOf, isImagePath } from "./projects.ts";

/**
 * 图片判定清单（`IMAGE_MIME` / `imageMimeOf` / `isImagePath`）的回归守卫。
 *
 * 为什么值得钉：这份清单是**主进程解码**与**渲染层「走图片视图还是文本编辑器」判定**的
 * 共同事实源。它一旦被放宽到主进程解不了的格式（如 svg/bmp），表现不是报错而是
 * 「点了文件、右栏空白」——静默失败最难查。反之若被收窄，图片会被当文本读出乱码。
 */

test("imageMimeOf：常见图片扩展名大小写不敏感", () => {
  assert.equal(imageMimeOf("a.png"), "image/png");
  assert.equal(imageMimeOf("a.PNG"), "image/png");
  assert.equal(imageMimeOf("dir/sub/photo.JPG"), "image/jpeg");
  assert.equal(imageMimeOf("a.jpeg"), "image/jpeg");
  assert.equal(imageMimeOf("a.webp"), "image/webp");
  assert.equal(imageMimeOf("a.gif"), "image/gif");
});

test("imageMimeOf：非图片与无扩展名一律 undefined（否则会被当图片读成空白）", () => {
  for (const path of ["a.ts", "a.tsx", "a.md", "a.json", "a.png.bak", "a.Png.txt", "Makefile", "", "dir.with.dots/file"]) {
    assert.equal(imageMimeOf(path), undefined, `${path} 不应判为图片`);
  }
});

test("imageMimeOf：取最后一个点之后为扩展名（目录名里的点不算）", () => {
  assert.equal(imageMimeOf("assets.v2/logo.png"), "image/png");
  assert.equal(imageMimeOf("v1.0/readme.md"), undefined);
  assert.equal(imageMimeOf("a.b/c"), undefined);
});

test("isImagePath 与 imageMimeOf 判定一致（两个导出谓词不得漂移）", () => {
  const samples = ["a.png", "a.PNG", "a.jpg", "a.webp", "a.gif", "a.ts", "noext", "", "x.png.bak"];
  for (const path of samples) {
    assert.equal(isImagePath(path), imageMimeOf(path) !== undefined, path);
  }
  for (const ext of Object.keys(IMAGE_MIME)) {
    assert.equal(isImagePath(`f${ext}`), true, `清单内的 ${ext} 必须被 isImagePath 认下`);
  }
});

test("IMAGE_MIME 清单本身：键是小写点扩展名、值是 image/* 且无重复 MIME 冲突", () => {
  for (const [ext, mime] of Object.entries(IMAGE_MIME)) {
    assert.match(ext, /^\.[a-z0-9]+$/, `扩展名 ${ext} 应为小写点开头`);
    assert.match(mime, /^image\/[a-z0-9.+-]+$/, `${ext} 的 MIME 不合法：${mime}`);
  }
  // jpg/jpeg 指向同一 MIME 是刻意的；但一个 MIME 不得有互相矛盾的多余键
  assert.equal(IMAGE_MIME[".jpg"], IMAGE_MIME[".jpeg"]);
});

test("通道常量：原图域与缩略图域必须是两个不同通道（否则预览会被 512px 缩略图顶掉）", () => {
  assert.equal(FS_IMAGE_CHANNEL, "fs:image");
  assert.equal(FS_THUMB_CHANNEL, "fs:thumb");
  assert.notEqual(FS_IMAGE_CHANNEL, FS_THUMB_CHANNEL);
});
