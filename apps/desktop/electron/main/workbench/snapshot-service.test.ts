import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { SnapshotService } from "./snapshot-service.ts";

const tempDirs: string[] = [];

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-wood-snapshot-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

test("revert restores CRLF content byte for byte", () => {
  const project = makeProject();
  const file = join(project, "crlf.txt");
  const original = Buffer.from("alpha\r\nbeta\r\n", "utf8");
  writeFileSync(file, original);

  const snapshots = new SnapshotService(project);
  snapshots.snapshot("edit", { path: "crlf.txt" });
  writeFileSync(file, "alpha\ngamma\n", "utf8");
  const [change] = snapshots.collectChanges();

  assert.ok(change);
  assert.equal(change.before, original.toString("utf8"));
  snapshots.revert(change.id);
  assert.deepEqual(readFileSync(file), original);
});

test("revert refuses to overwrite a newer edit", () => {
  const project = makeProject();
  const file = join(project, "changed.txt");
  writeFileSync(file, "before\n", "utf8");

  const snapshots = new SnapshotService(project);
  snapshots.snapshot("edit", { path: "changed.txt" });
  writeFileSync(file, "agent edit\n", "utf8");
  const [change] = snapshots.collectChanges();
  writeFileSync(file, "newer user edit\n", "utf8");

  assert.throws(() => snapshots.revert(change.id), /再次修改/);
  assert.equal(readFileSync(file, "utf8"), "newer user edit\n");
});

test("snapshot rejects sibling paths with the same prefix", () => {
  const project = makeProject();
  const sibling = `${project}-outside`;
  assert.equal(new SnapshotService(project).resolveInProject(join(sibling, "file.txt")), undefined);
});
