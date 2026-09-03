# T8.P 主机门禁：主进程 CJS→ESM 切换验收（临时脚本，验收后删除）
# 全部结果追加到 docs/proofs/ui-v3/t8p-gate.log
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\1\Desktop\pi-wood'
$app  = Join-Path $root 'apps\desktop'
$log  = Join-Path $app 'docs\proofs\ui-v3\t8p-gate.log'
$proofs = Join-Path $app 'docs\proofs\ui-v3'
New-Item -ItemType Directory -Force -Path $proofs | Out-Null
Remove-Item $log -ErrorAction SilentlyContinue
"=== T8.P GATE START $(Get-Date -Format o) ===" | Out-File $log -Encoding utf8

# [0] 杀残留 electron
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
"[0] stray electron killed" | Out-File $log -Append -Encoding utf8

Set-Location $root

# [1] 全仓 typecheck
"=== [1] typecheck ===" | Out-File $log -Append -Encoding utf8
pnpm -r typecheck *>> $log
$tc = $LASTEXITCODE
"TYPECHECK_EXIT=$tc" | Out-File $log -Append -Encoding utf8

# [2] 全仓单测
"=== [2] test ===" | Out-File $log -Append -Encoding utf8
pnpm -r test *>> $log
$test = $LASTEXITCODE
"TEST_EXIT=$test" | Out-File $log -Append -Encoding utf8

# [3] 完整构建（main+preload+renderer 三目标）
"=== [3] build ===" | Out-File $log -Append -Encoding utf8
Set-Location $app
pnpm build *>> $log
$build = $LASTEXITCODE
"BUILD_EXIT=$build" | Out-File $log -Append -Encoding utf8
if ($build -ne 0) {
  "GATE_ABORT=build_failed" | Out-File $log -Append -Encoding utf8
  exit 1
}

# [4] 产物格式断言（grep 判据，不靠肉眼）
"=== [4] assertions ===" | Out-File $log -Append -Encoding utf8
$mainJs = Get-Content (Join-Path $app 'out\main\index.js') -Raw
$preMjs = Get-Content (Join-Path $app 'out\preload\index.mjs') -Raw
function CountOf($hay, $needle) { ([regex]::Matches($hay, [regex]::Escape($needle))).Count }
$nStrict = '"use strict"'
$nPiStatic = 'import * as PiSdk from "@earendil-works/pi-coding-agent"'
$nPiDyn = 'import("@earendil-works/pi-coding-agent")'
$mainUseStrict = CountOf $mainJs $nStrict
$mainDefProp = CountOf $mainJs '__defProp'
$mainRequire = CountOf $mainJs 'require('
$mainPiStatic = CountOf $mainJs $nPiStatic
$mainPiDyn = CountOf $mainJs $nPiDyn
$preExists = Test-Path (Join-Path $app 'out\preload\index.mjs')
$preUseStrict = CountOf $preMjs $nStrict
$preHasImport = [bool]($preMjs -match 'import \{')
"main_use_strict=$mainUseStrict" | Out-File $log -Append -Encoding utf8
"main___defProp=$mainDefProp" | Out-File $log -Append -Encoding utf8
"main_require_paren=$mainRequire" | Out-File $log -Append -Encoding utf8
"main_static_pi_import=$mainPiStatic" | Out-File $log -Append -Encoding utf8
"main_dynamic_pi_import=$mainPiDyn" | Out-File $log -Append -Encoding utf8
"preload_mjs_exists=$preExists" | Out-File $log -Append -Encoding utf8
"preload_use_strict=$preUseStrict" | Out-File $log -Append -Encoding utf8
"preload_has_import=$preHasImport" | Out-File $log -Append -Encoding utf8

# [5] 三探针（headless，build 已完成，直接跑 electron）
Set-Location $app
$ev = Join-Path $app 'node_modules\.bin\electron.cmd'
"=== [5a] plugin-probe ===" | Out-File $log -Append -Encoding utf8
& $ev . --plugin-probe *>> $log
"PLUGIN_PROBE_EXIT=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8
"=== [5b] goal-probe ===" | Out-File $log -Append -Encoding utf8
& $ev . --goal-probe *>> $log
"GOAL_PROBE_EXIT=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8
"=== [5c] memory-probe ===" | Out-File $log -Append -Encoding utf8
& $ev . --memory-probe *>> $log
"MEMORY_PROBE_EXIT=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

# [6] ui-stress 10000
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
"=== [6] ui-stress ===" | Out-File $log -Append -Encoding utf8
$evv = Join-Path $app 'node_modules\.bin\electron-vite.cmd'
& $evv dev -- --ui-stress (Join-Path $proofs 't8p-ui-stress.png') 10000 *>> $log
"UI_STRESS_EXIT=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

# [7] capture 静态截图
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
"=== [7] capture ===" | Out-File $log -Append -Encoding utf8
& $evv dev -- --capture (Join-Path $proofs 't8p-capture.png') *>> $log
"CAPTURE_EXIT=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

# [8] ui-chat 真实对话（走正式引擎链路，含真实 API）
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
"=== [8] ui-chat ===" | Out-File $log -Append -Encoding utf8
& $evv dev -- --ui-chat (Join-Path $proofs 't8p-ui-chat.png') *>> $log
"UI_CHAT_EXIT=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

# [9] 打包产物（package:dir；干净安装验收受 T5.3 环境阻塞，仅产留档）
"=== [9] package:dir ===" | Out-File $log -Append -Encoding utf8
Set-Location $app
pnpm package:dir *>> $log
"PACKAGE_DIR_EXIT=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

"=== T8.P GATE DONE $(Get-Date -Format o) ===" | Out-File $log -Append -Encoding utf8
