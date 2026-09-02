// pi-wood fork deviation: upstream registers Pi + Claude + Codex harnesses here.
// pi-wood only wires Pi subagents (in-process), so the Claude/Codex harness
// directories and their `@anthropic-ai/claude-agent-sdk` dependency are removed
// from this vendor tree. Do not reintroduce them here without also vendoring
// those harness dirs and their deps. ADRs 0008/0009 (kept in docs/adr for
// reference) describe the removed harnesses.
import {
  createHarnessRegistry,
  type HarnessRegistry,
} from "./harnesses/contract.ts";
import { createPiHarness } from "./harnesses/pi/harness.ts";

/**
 * The only production edge that composes concrete backends. Core feature and
 * tool registration receives the resulting public registry and never names an
 * adapter.
 *
 * NOTE (pi-wood): the desktop integration does not rely on this default
 * registry — it builds its own Pi harness with a custom `sessionOptionsFactory`
 * so child runs pass through the desktop approval gate. This stays only as the
 * inert fallback used if `createSubagentRuntime` is called without explicit
 * `harnesses`.
 */
export function createDefaultHarnessRegistry(): HarnessRegistry {
  return createHarnessRegistry([createPiHarness()]);
}
