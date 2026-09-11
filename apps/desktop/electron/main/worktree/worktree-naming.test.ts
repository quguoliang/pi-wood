import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WORKTREE_BRANCH_PREFIX,
  branchFor,
  conversationShortId,
  isManagedWorktree,
  isPathLengthOk,
  mainProjectRootOf,
  sanitizeSegment,
  worktreePathFor,
} from "./worktree-naming.ts";

describe("conversationShortId", () => {
  it("conv-<n>-<uuid> → uuid 段", () => {
    assert.equal(conversationShortId("conv-3-abc12345"), "abc12345");
  });
  it("无惯例格式 → 净化原串", () => {
    assert.equal(conversationShortId("My Conv/1"), "my-conv-1");
  });
  it("净化后为空 → 回落 wt", () => {
    assert.equal(conversationShortId("..."), "wt");
  });
});

describe("sanitizeSegment（Windows 禁忌与大小写）", () => {
  it("非法字符替换为 -", () => {
    assert.equal(sanitizeSegment('a<b>c:"d"|e?*'), "a-b-c--d--e--");
  });
  it("去结尾点与空白（Windows 目录名禁忌）", () => {
    assert.equal(sanitizeSegment("abc. .."), "abc");
  });
  it("统一小写（大小写不敏感文件系统防同名冲突）", () => {
    assert.equal(sanitizeSegment("ABC123"), "abc123");
  });
  it("空 → wt", () => {
    assert.equal(sanitizeSegment(""), "wt");
  });
});

describe("worktreePathFor / branchFor", () => {
  it("路径 = <project>/.pi-wood/worktrees/<shortId>（保留项目路径原分隔符）", () => {
    assert.equal(worktreePathFor("/repo/proj", "conv-1-aabbccdd"), "/repo/proj/.pi-wood/worktrees/aabbccdd");
    assert.equal(worktreePathFor("C:\\repo\\proj", "conv-2-11223344"), "C:\\repo\\proj\\.pi-wood\\worktrees\\11223344");
  });
  it("项目路径尾部分隔符不重复", () => {
    assert.equal(worktreePathFor("/repo/proj/", "conv-1-aabbccdd"), "/repo/proj/.pi-wood/worktrees/aabbccdd");
  });
  it("分支 = piwood/<shortId>", () => {
    assert.equal(branchFor("conv-7-aabbccdd"), "piwood/aabbccdd");
    assert.ok(branchFor("conv-7-aabbccdd").startsWith(WORKTREE_BRANCH_PREFIX));
  });
});

describe("isPathLengthOk", () => {
  it("超限判假", () => {
    assert.equal(isPathLengthOk("x".repeat(241)), false);
    assert.equal(isPathLengthOk("x".repeat(240)), true);
  });
});

describe("isManagedWorktree（孤儿对账判据：只管本项目建的树）", () => {
  it("路径在管辖目录下命中（大小写不敏感）", () => {
    assert.equal(isManagedWorktree("/Repo/Proj/.Pi-Wood/Worktrees/abc", "/repo/proj"), true);
  });
  it("Windows 反斜杠路径命中", () => {
    assert.equal(isManagedWorktree("C:\\repo\\proj\\.pi-wood\\worktrees\\abc", "C:\\repo\\proj"), true);
  });
  it("⚠ 跨项目误报（2026-09-11 修）：同仓库内子目录下建的树，即便分支带 piwood/ 前缀也不算本项目", () => {
    // 真实场景：apps/desktop/scratch/test-project 不是独立仓库，git worktree add 把树建到该子目录、
    // 却注册进外层 pi-wood 仓库。旧实现按分支前缀判定 → 外层项目会列出它、且回收守卫按路径拒绝。
    assert.equal(
      isManagedWorktree("/repo/apps/scratch/test-project/.pi-wood/worktrees/abc", "/repo"),
      false,
    );
  });
  it("同前缀的兄弟目录不算（worktrees-old 不是 worktrees）", () => {
    assert.equal(isManagedWorktree("/repo/.pi-wood/worktrees-old/abc", "/repo"), false);
  });
  it("管辖目录本身不是树", () => {
    assert.equal(isManagedWorktree("/repo/.pi-wood/worktrees", "/repo"), false);
  });
  it("用户自建的树不管", () => {
    assert.equal(isManagedWorktree("/repo/other-wt", "/repo"), false);
  });
});

describe("mainProjectRootOf（T8.7 记忆/项目 scope 归一到主项目根）", () => {
  it("worktree 路径归到主项目根", () => {
    assert.equal(mainProjectRootOf("/repo/proj/.pi-wood/worktrees/abc123"), "/repo/proj");
    assert.equal(mainProjectRootOf("/repo/proj/.pi-wood/worktrees/abc123/nested/deep"), "/repo/proj");
  });
  it("Windows 分隔符同样归一", () => {
    assert.equal(mainProjectRootOf("C:\\repo\\proj\\.pi-wood\\worktrees\\abc"), "C:\\repo\\proj");
  });
  it("非管辖路径原样返回（含主项目根本身）", () => {
    assert.equal(mainProjectRootOf("/repo/proj"), "/repo/proj");
    assert.equal(mainProjectRootOf("/repo/other/.pi-wood/memory"), "/repo/other/.pi-wood/memory");
    assert.equal(mainProjectRootOf(""), "");
  });
  it("大小写不敏感匹配 .PI-WOOD/WORKTREES", () => {
    assert.equal(mainProjectRootOf("/repo/proj/.PI-WOOD/WORKTREES/abc"), "/repo/proj");
  });
});
