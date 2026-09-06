#!/usr/bin/env bash
# T8.8~T8.10 真机门禁日脚本（macOS）——一次性还掉 T8.4~T8.10 的真机欠账并留证。
#
# 用法：
#   bash scripts/t88-verify.sh              # 全量（typecheck/test/build + 五探针 + concurrency + latency + ui-latency + ui-chat + 打包）
#   SKIP_PACKAGE=1 bash scripts/t88-verify.sh   # 跳过打包冒烟
#   SKIP_UI=1 bash scripts/t88-verify.sh        # 跳过 --ui-chat（需密钥，最慢）
#   SKIP_GUI=1 bash scripts/t88-verify.sh       # 跳过 --ui-latency-probe（要可见窗口，会抢焦点）
# 证据统一落 apps/desktop/docs/proofs/T8.8/。任何一步失败立即以非零码退出并指出日志。
#
# ⚠ 本脚本设计在【开发者本机】跑：千问办公沙箱无 DISPLAY、node_modules 里的 Electron 是
#   darwin 二进制，探针类（需 Electron 进程）无法在沙箱内代跑。
set -uo pipefail
cd "$(dirname "$0")/.."
# 绝对路径：探针阶段会 cd apps/desktop，相对路径会让证据落盘失效
PROOF="$(pwd)/apps/desktop/docs/proofs/T8.8"
mkdir -p "$PROOF"
LOG() { echo "[$(date +%H:%M:%S)] $*"; }
RUN() { # RUN <logname> <cmd...>
  local name="$1"; shift
  LOG "START $name: $*"
  if "$@" >"$PROOF/$name.log" 2>&1; then
    LOG "PASS  $name"
  else
    local code=$?
    LOG "FAIL  $name (exit=$code) —— 见 $PROOF/$name.log"
    tail -20 "$PROOF/$name.log"
    exit $code
  fi
}

# 0) 手滑保护：残留的旧 Electron / dev 实例会污染验证（MEMORY 铁律）
# ⚠ 模式必须锁定本项目路径——宽松的 "Electron.app/..." 会误杀用户其它 Electron 应用（如 Trae CN）
pkill -9 -f "pi-wood.*/node_modules/.pnpm/electron@.*/dist/Electron.app/Contents/MacOS/Electron" 2>/dev/null || true
pkill -9 -f "pi-wood.*/electron-vite" 2>/dev/null || true
sleep 1

# 0.5) 单测清单覆盖对账：desktop 的 test 脚本是显式文件清单，漏登记 = 静默漏测
#      （T8.8 实际踩过：conversation-badge.test.ts 5 例没进清单，门禁跑 216 而记录写 221）
(
  set -e
  cd apps/desktop
  listed="$(node -e 'process.stdout.write(require("./package.json").scripts.test)')"
  missing=0
  for f in $(find electron src -name "*.test.ts" -not -path "*/vendor/*" | sort); do
    echo "$listed" | grep -qF "$f" || { echo "单测未登记进 test 脚本: $f"; missing=1; }
  done
  test "$missing" = "0" || exit 1
  echo "单测清单覆盖对账通过（$(find electron src -name "*.test.ts" -not -path "*/vendor/*" | wc -l | tr -d ' ') 个文件全在案）"
) >"$PROOF/test-coverage.log" 2>&1 && LOG "PASS  test-coverage" || { LOG "FAIL test-coverage —— 见 $PROOF/test-coverage.log"; tail -20 "$PROOF/test-coverage.log"; exit 1; }

# 1) 基础门禁
RUN typecheck  pnpm -r typecheck
RUN test       pnpm -r test
RUN build      pnpm --filter @pi-wood/desktop exec electron-vite build

# 2) 产物 ESM/新符号断言（T8.4~T8.8 的关键符号必须进 bundle）
(
  set -e
  cd apps/desktop
  for sym in "approval:focus-requested" "agent_start 排队" "engineMaxPrompts" "quotaOverLimitAction" "runConcurrencyProbe\|concurrency-probe" "debugEcho" "conversation-dot\|任务进行中"; do
    grep -q "$sym" out/main/index.js out/renderer/assets/index-*.js 2>/dev/null \
      || { echo "产物缺符号: $sym"; exit 1; }
  done
  test "$(grep -c '"use strict"' out/main/index.js)" = "0"
  test "$(grep -c 'require(' out/main/index.js)" = "0"
  echo "产物断言全过"
) >"$PROOF/artifacts.log" 2>&1 && LOG "PASS  artifacts" || { LOG "FAIL artifacts —— 见 $PROOF/artifacts.log"; exit 1; }

# 3) 五探针回归（均无窗早退 + app.exit；cwd 必须是 apps/desktop）
cd apps/desktop
RUN probe-worktree        node electron/main/engine/worktree-probe.mjs
RUN probe-plugin          pnpm exec electron . --plugin-probe
RUN probe-goal            pnpm exec electron . --goal-probe
RUN probe-memory          pnpm exec electron . --memory-probe
RUN probe-engine-process  pnpm exec electron . --engine-process-probe
RUN probe-conversation    pnpm exec electron . --conversation-probe

# 4) 收口断言：T8.8 并发门禁 / T8.9 红线度量 / T8.7 作用域归属 / T8.4 审批安全底线
RUN probe-concurrency     pnpm exec electron . --concurrency-probe
RUN probe-latency         pnpm exec electron . --latency-probe
RUN probe-workspace-scope pnpm exec electron . --workspace-scope-probe
RUN probe-approval        pnpm exec electron . --approval-probe

# 4b) T8.10 带窗红线探针（第二跳 / 切换首屏 / 掉帧 / 主进程 CPU）——需要可见窗口，会抢焦点
if [ "${SKIP_GUI:-0}" != "1" ]; then
  RUN probe-ui-latency    pnpm exec electron . --ui-latency-probe
fi

# 5) 真模型对话链路（密钥在 apps/desktop/.env → loadPrivateEnv；含审批/工具往返）
if [ "${SKIP_UI:-0}" != "1" ]; then
  RUN ui-chat             pnpm exec electron . --ui-chat
fi

# 6) 打包冒烟：packaged child 载 SDK/扩展（T8.0 P1-d / T8.8 验收最后一条）
if [ "${SKIP_PACKAGE:-0}" != "1" ]; then
  # electron-builder 默认会去 GitHub 重下 Electron 发行包（09-05 真机：connection reset by peer → 整步 FAIL）。
  # node_modules 里已有解好的同版本 dist，能指过去就指过去（离线、且保证与依赖版本一致）。
  EDIST="$(node -p 'require("path").join(require("path").dirname(require.resolve("electron")),"dist")' 2>/dev/null || true)"
  if [ -n "$EDIST" ] && [ -d "$EDIST" ]; then
    LOG "package:dir 使用本地 Electron dist：$EDIST"
    RUN package-dir pnpm exec electron-builder --dir "--config.electronDist=$EDIST"
  else
    RUN package-dir pnpm package:dir
  fi
  # 产物目录名随平台/架构变：macOS arm64=release/mac-arm64/pi-wood.app/…、Windows=release/win-unpacked/pi-wood.exe
  PACKAGED_BIN="$(ls -d release/mac-*/pi-wood.app/Contents/MacOS/pi-wood release/mac-unpacked/pi-wood.app/Contents/MacOS/pi-wood release/win-unpacked/pi-wood.exe 2>/dev/null | head -1)"
  if [ -z "$PACKAGED_BIN" ]; then
    LOG "FAIL packaged-probe —— 打包产物里没找到可执行文件（release/ 下 mac-*/win-unpacked 均无）"; exit 1
  fi
  LOG "packaged 探针可执行：$PACKAGED_BIN"
  RUN probe-conversation-packaged "./$PACKAGED_BIN" --conversation-probe=packaged
fi

LOG "================ 全部通过 ================"
LOG "证据目录：$PROOF/"
