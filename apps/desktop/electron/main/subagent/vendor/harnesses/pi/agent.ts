/** The retained Pi SDK Conversation owner and its fixed provider policy. */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentSession,
  type CreateAgentSessionOptions,
  createAgentSession,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  DefaultResourceLoader,
  getAgentDir,
  type InlineExtension,
  type LoadExtensionsResult,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { withPiChildExtensionLoad } from "../../pi-child-extension-load.ts";
import type {
  RunEnding,
  SubagentContext,
  SubagentRun,
  SubagentTask,
} from "../../run.ts";
import { parseTools, shouldAppendSystemPrompt } from "../contract.ts";
import { runPiAttempt } from "./attempt.ts";

const PI_ORCHESTRATION_TOOLS = [
  "agent_start",
  "agent_resume",
  "agent_wait",
  "agent_result",
  "agent_cancel",
  "agent_steer",
] as const;
const PI_EXTENSION_SHUTDOWN_TIMEOUT_MS = 1_000;

export type PiSession = Pick<
  AgentSession,
  | "prompt"
  | "steer"
  | "subscribe"
  | "bindExtensions"
  | "abort"
  | "waitForIdle"
  | "clearQueue"
  | "dispose"
  | "messages"
  | "isIdle"
> & {
  extensionRunner: {
    emit(event: { type: "session_shutdown"; reason: "quit" }): Promise<unknown>;
  };
};

export type PiSessionFactory = (
  options: CreateAgentSessionOptions,
) => Promise<{ session: PiSession }>;

export type PiSessionOptionsFactory = (
  context: SubagentContext,
  resolvedModel?: string,
  resolvedThinking?: string,
  agentDir?: string,
  signal?: AbortSignal,
) => Promise<CreateAgentSessionOptions>;

export interface PiManagedAdapter {
  prepareRun(task: SubagentTask): {
    supportedControls: readonly ["steer"];
    execute(run: SubagentRun): Promise<RunEnding>;
  };
  close(): Promise<void>;
}

function defaultPiSessionFactory(
  options: CreateAgentSessionOptions,
): Promise<{ session: PiSession }> {
  return createAgentSession(options);
}

function packageNameForPath(filePath: string): string | undefined {
  let directory = path.dirname(filePath);
  try {
    if (fs.statSync(filePath).isDirectory()) directory = filePath;
  } catch {
    // A loader diagnostic may refer to a path that disappeared after loading.
  }
  while (true) {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(directory, "package.json"), "utf8"),
      ) as { name?: unknown };
      if (typeof manifest.name === "string") return manifest.name;
    } catch {
      // Walk to the filesystem root until a package identity is found.
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

const PI_SUBAGENT_PACKAGE_NAME =
  packageNameForPath(fileURLToPath(import.meta.url)) ?? "pi-subagent";

/** Remove this package by package identity before an in-process child binds. */
export function filterPiChildExtensions(
  base: LoadExtensionsResult,
): LoadExtensionsResult {
  return {
    ...base,
    extensions: base.extensions.filter(
      (extension) =>
        packageNameForPath(extension.resolvedPath) !== PI_SUBAGENT_PACKAGE_NAME,
    ),
  };
}

function modelForReference(
  runtime: ModelRuntime,
  reference: string,
): CreateAgentSessionOptions["model"] {
  const separator = reference.indexOf("/");
  if (separator > 0) {
    return runtime.getModel(
      reference.slice(0, separator),
      reference.slice(separator + 1),
    );
  }
  return runtime.getModels().find((model) => model.id === reference);
}

/** Build the fixed SDK policy for one retained Pi Conversation. */
export async function createPiSessionOptions(
  context: SubagentContext,
  resolvedModel?: string,
  resolvedThinking?: string,
  agentDir = getAgentDir(),
  signal?: AbortSignal,
  // pi-wood fork deviation: allow the host to inject inline extension factories
  // (e.g. the desktop approval gate) into the child session's resource loader so
  // child tool calls still pass through host policy. Upstream has no such seam.
  extraExtensionFactories?: InlineExtension[],
  // pi-wood fork deviation: the child session's tool_call event hook does not fire,
  // so the host supplies a direct guard that the wrapped bash execute calls before
  // running. Returns a block-reason string to deny, or undefined to allow.
  childToolGuard?: (toolName: string, input: unknown) => Promise<string | undefined>,
): Promise<CreateAgentSessionOptions> {
  const settingsManager = SettingsManager.create(context.cwd, agentDir, {
    projectTrusted: context.projectTrusted,
  });
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
    ...(signal ? { signal } : {}),
  });
  const model = resolvedModel
    ? modelForReference(modelRuntime, resolvedModel)
    : undefined;
  if (resolvedModel && !model) {
    throw new Error(
      `Pi model '${resolvedModel}' was not found in the model catalogue`,
    );
  }

  const configuredPrompt = context.config.systemPrompt;
  const resourceLoader = new DefaultResourceLoader({
    cwd: context.cwd,
    agentDir,
    settingsManager,
    extensionsOverride: filterPiChildExtensions,
    // pi-wood fork deviation: host-injected inline factories (desktop gate).
    ...(extraExtensionFactories && extraExtensionFactories.length > 0
      ? { extensionFactories: extraExtensionFactories }
      : {}),
    ...(configuredPrompt.trim().length === 0
      ? {}
      : shouldAppendSystemPrompt(context.config, "profile")
        ? {
            appendSystemPromptOverride: (base: string[]) => [
              ...base,
              configuredPrompt,
            ],
          }
        : { systemPromptOverride: () => configuredPrompt }),
  });
  // Pi initializes extension factories while reload() discovers resources;
  // extensionsOverride is applied only afterward. Scope the discriminator to
  // this asynchronous child-owned load chain so parent reloads can reattach.
  await withPiChildExtensionLoad(() =>
    resourceLoader.reload({
      resolveProjectTrust: async () => context.projectTrusted,
    }),
  );

  const tools = parseTools(context.config, "profile");
  const bash = createBashToolDefinition(context.cwd, {
    commandPrefix: settingsManager.getShellCommandPrefix(),
    shellPath: settingsManager.getShellPath(),
    spawnHook: (spawn) => ({
      ...spawn,
      env: {
        ...spawn.env,
        PI_SUBAGENT_DEPTH: String(context.childDepth),
      },
    }),
  });

  // pi-wood fork deviation: the child (print-mode) session does not surface tool_call
  // to inline extension hooks, so gate the child's high-risk tools at execute() directly
  // via the host guard. customTools override builtins by name (same as the bash swap above).
  type GuardableTool = {
    name: string;
    execute: (...args: unknown[]) => Promise<unknown>;
  };
  const guardTool = <T extends GuardableTool>(def: T): T => {
    if (!childToolGuard) return def;
    const original = def.execute.bind(def);
    return {
      ...def,
      execute: async (
        toolCallId: string,
        params: unknown,
        signal: unknown,
        onUpdate: unknown,
        ctx: unknown,
      ) => {
        const reason = await childToolGuard(def.name, params);
        if (reason) {
          return {
            content: [{ type: "text", text: `已由桌面审批策略拦截：${reason}` }],
            details: undefined,
            isError: true,
          };
        }
        return original(toolCallId, params, signal, onUpdate, ctx);
      },
    } as T;
  };
  const guardedChildTools = [
    guardTool(bash as unknown as GuardableTool),
    guardTool(createEditToolDefinition(context.cwd) as unknown as GuardableTool),
    guardTool(createWriteToolDefinition(context.cwd) as unknown as GuardableTool),
  ];

  return {
    cwd: context.cwd,
    agentDir,
    modelRuntime,
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(context.cwd),
    model,
    thinkingLevel:
      resolvedThinking as CreateAgentSessionOptions["thinkingLevel"],
    ...(tools === undefined ? {} : { tools }),
    excludeTools: [...PI_ORCHESTRATION_TOOLS],
    // Override the built-in bash/edit/write with guarded versions (customTools replace
    // same-named builtins); the `tools` allowlist still decides which are active.
    customTools: guardedChildTools as unknown as NonNullable<
      CreateAgentSessionOptions["customTools"]
    >,
  };
}

async function withBoundedCleanup(
  promise: Promise<unknown>,
  timeoutMs = PI_EXTENSION_SHUTDOWN_TIMEOUT_MS,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const completed = await Promise.race([
    promise.catch(() => undefined).then(() => true),
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  return completed;
}

interface PendingPiSessionCleanup {
  readonly settled: Promise<void>;
}

async function stopPiSession(
  session: PiSession,
): Promise<PendingPiSessionCleanup | undefined> {
  let abortWork: Promise<unknown>;
  try {
    abortWork = Promise.resolve(session.abort());
  } catch {
    abortWork = Promise.resolve();
  }
  let idleWork: Promise<unknown>;
  try {
    idleWork = Promise.resolve(session.waitForIdle());
  } catch {
    idleWork = Promise.resolve();
  }
  const settled = Promise.allSettled([abortWork, idleWork]).then((outcomes) =>
    outcomes[1]?.status === "fulfilled"
      ? undefined
      : new Promise<void>(() => {}),
  );
  return (await withBoundedCleanup(settled)) ? undefined : { settled };
}

async function disposePiSession(session: PiSession): Promise<void> {
  await withBoundedCleanup(
    Promise.resolve().then(() =>
      session.extensionRunner.emit({
        type: "session_shutdown",
        reason: "quit",
      }),
    ),
  );
  try {
    session.dispose();
  } catch {
    // Cleanup cannot alter an already-settled Run.
  }
}

/**
 * Create one retained SDK Conversation for a prepared Pi Subagent.
 *
 * Lazy session construction, extension binding, active-Attempt ownership, and
 * retained disposal stay here. Each execution delegates Run-local provider
 * resources and behavior to one disposable Pi Attempt.
 */
export function createPiManagedAdapter(
  context: SubagentContext,
  options: {
    resolvedModel?: string;
    resolvedThinking?: string;
    sessionFactory?: PiSessionFactory;
    sessionOptionsFactory?: PiSessionOptionsFactory;
    agentDir?: string;
    /** pi-wood fork: host sink for raw child-session events, tagged with run id. */
    onRunEvent?: (runId: string, event: unknown) => void;
  } = {},
): PiManagedAdapter {
  const sessionFactory = options.sessionFactory ?? defaultPiSessionFactory;
  const sessionOptionsFactory =
    options.sessionOptionsFactory ?? createPiSessionOptions;
  let session: PiSession | undefined;
  let creating: Promise<PiSession> | undefined;
  let active: Promise<RunEnding> | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let disposed = false;
  let cancelActive: (() => Promise<void>) | undefined;
  let pendingSteeringCleanup: Promise<void> | undefined;
  let pendingNativeCleanup: Promise<void> | undefined;

  const initialize = (signal?: AbortSignal): Promise<PiSession> => {
    if (session) return Promise.resolve(session);
    if (creating) return creating;
    creating = (async () => {
      const sdkOptions = await sessionOptionsFactory(
        context,
        options.resolvedModel,
        options.resolvedThinking,
        options.agentDir,
        signal,
      );
      if (closed || signal?.aborted) {
        throw new Error("Pi session initialization was cancelled");
      }
      const created = (await sessionFactory(sdkOptions)).session;
      try {
        if (closed || signal?.aborted) {
          created.clearQueue();
          await stopPiSession(created);
          throw new Error("Pi session initialization was cancelled");
        }
        await created.bindExtensions({ mode: "print" });
        if (closed || signal?.aborted) {
          created.clearQueue();
          await stopPiSession(created);
          throw new Error("Pi session initialization was cancelled");
        }
        session = created;
        return created;
      } catch (error) {
        await disposePiSession(created);
        throw error;
      }
    })().finally(() => {
      creating = undefined;
    });
    return creating;
  };

  return {
    prepareRun(task) {
      return {
        supportedControls: ["steer"],
        execute(run) {
          if (active) {
            return Promise.resolve({
              ending: "failed",
              errorMessage: "Pi adapter already has an active Run",
            });
          }
          const execution = runPiAttempt({
            task,
            run,
            onEvent: options.onRunEvent,
            conversation: {
              isClosed: () => closed,
              hasPendingCleanup: () =>
                Boolean(pendingSteeringCleanup || pendingNativeCleanup),
              acquireSession: initialize,
              stopSession: stopPiSession,
              registerCancellation(cancel) {
                cancelActive = cancel;
                return () => {
                  if (cancelActive === cancel) cancelActive = undefined;
                };
              },
              retainSteeringCleanup(cleanup) {
                pendingSteeringCleanup = cleanup;
              },
              releaseSteeringCleanup(cleanup) {
                if (pendingSteeringCleanup === cleanup) {
                  pendingSteeringCleanup = undefined;
                }
              },
              retainNativeCleanup(cleanup) {
                pendingNativeCleanup = cleanup;
              },
              releaseNativeCleanup(cleanup) {
                if (pendingNativeCleanup === cleanup) {
                  pendingNativeCleanup = undefined;
                }
              },
            },
          });
          active = execution.finally(() => {
            active = undefined;
          });
          return active;
        },
      };
    },
    close() {
      closePromise ??= (async () => {
        closed = true;
        const pendingCreation = creating;
        if (cancelActive) {
          await withBoundedCleanup(cancelActive());
        } else if (session) {
          try {
            session.clearQueue();
          } catch {
            // Continue through abort and bounded shutdown.
          }
          await stopPiSession(session);
        }
        await withBoundedCleanup(
          Promise.all([
            active?.catch(() => undefined),
            pendingCreation?.catch(() => undefined),
          ]),
        );
        if (session && !disposed) {
          disposed = true;
          await disposePiSession(session);
          session = undefined;
        }
      })();
      return closePromise;
    },
  };
}
