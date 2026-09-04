$ErrorActionPreference = 'Continue'
Set-Location C:\Users\1\Desktop\pi-wood
$log = 'C:\Users\1\Desktop\pi-wood\scripts\t81-gate.log'
"START $(Get-Date -Format o)" | Out-File -FilePath $log -Encoding ascii

'== 0. kill stray electron (dev instance included), keep QoderWork itself' | Out-File -FilePath $log -Append -Encoding ascii
Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill(); $_.WaitForExit(5000) } catch {} }
Start-Sleep -Seconds 2

'== 0.5 pnpm install (T8.1 added @types/node to ipc-schema + engine)' | Out-File -FilePath $log -Append -Encoding ascii
pnpm install 2>&1 | Select-Object -Last 15 | Out-File -FilePath $log -Append -Encoding ascii
"install_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 1. pnpm -r typecheck' | Out-File -FilePath $log -Append -Encoding ascii
pnpm -r typecheck 2>&1 | Out-File -FilePath $log -Append -Encoding ascii
"typecheck_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 2. pnpm -r test' | Out-File -FilePath $log -Append -Encoding ascii
pnpm -r test 2>&1 | Out-File -FilePath $log -Append -Encoding ascii
"test_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 3. build desktop (main = 2 entries now)' | Out-File -FilePath $log -Append -Encoding ascii
pnpm --filter @pi-wood/desktop build 2>&1 | Out-File -FilePath $log -Append -Encoding ascii
"build_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 3b. out/main listing' | Out-File -FilePath $log -Append -Encoding ascii
Get-ChildItem C:\Users\1\Desktop\pi-wood\apps\desktop\out\main -Recurse | ForEach-Object { $_.FullName.Replace('C:\Users\1\Desktop\pi-wood\apps\desktop\out\main\','') + ' ' + $_.Length } | Out-File -FilePath $log -Append -Encoding ascii

'== 4. probe:conversation (T8.1 gate)' | Out-File -FilePath $log -Append -Encoding ascii
pnpm --filter @pi-wood/desktop probe:conversation 2>&1 | Out-File -FilePath $log -Append -Encoding ascii
"probe_conversation_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 5. probe:engine-process (T8.0 regression)' | Out-File -FilePath $log -Append -Encoding ascii
pnpm --filter @pi-wood/desktop probe:engine-process 2>&1 | Out-File -FilePath $log -Append -Encoding ascii
"probe_engine_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 6. probe:worktree (T8.0 regression)' | Out-File -FilePath $log -Append -Encoding ascii
pnpm --filter @pi-wood/desktop probe:worktree 2>&1 | Out-File -FilePath $log -Append -Encoding ascii
"probe_worktree_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 7. probe:plugins / goal / memory (既有探针回归)' | Out-File -FilePath $log -Append -Encoding ascii
pnpm --filter @pi-wood/desktop probe:plugins 2>&1 | Select-Object -Last 6 | Out-File -FilePath $log -Append -Encoding ascii
"probe_plugins_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii
pnpm --filter @pi-wood/desktop probe:goal 2>&1 | Select-Object -Last 6 | Out-File -FilePath $log -Append -Encoding ascii
"probe_goal_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii
pnpm --filter @pi-wood/desktop probe:memory 2>&1 | Select-Object -Last 6 | Out-File -FilePath $log -Append -Encoding ascii
"probe_memory_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

"DONE $(Get-Date -Format o)" | Out-File -FilePath $log -Append -Encoding ascii
'GATE FINISHED - see log' | Out-File -FilePath $log -Append -Encoding ascii
