import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
assert.match(html, /<h1>Verified by pi-wood<\/h1>/);
console.log("webapp verification passed");
