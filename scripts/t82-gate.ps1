$ErrorActionPreference = 'Continue'
Set-Location C:\Users\1\Desktop\pi-wood
$log = 'C:\Users\1\Desktop\pi-wood\scripts\t82-gate.log'
$pnpmCmd = 'C:\Users\1\AppData\Roaming\npm\pnpm.cmd'
"START $(Get-Date -Format o)" | Out-File -FilePath $log -Encoding ascii

# NOTE: keep this file ASCII-only. PowerShell 5.1 reads BOM-less UTF-8 as ANSI and
# chokes on CJK comments (ParserError), which is how the first T8.2 gate run failed.

'== 0. kill stray electron' | Out-File -FilePath $log -Encoding ascii
Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill(); $_.WaitForExit(5000) } catch {} }
Start-Sleep -Seconds 2

'== 1. pnpm -r typecheck' | Out-File -FilePath $log -Append -Encoding ascii
& $pnpmCmd -r typecheck 2>&1 | Out-File -FilePath $log -Append -Encoding ascii
"typecheck_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 2. pnpm -r test' | Out-File -FilePath $log -Append -Encoding ascii
& $pnpmCmd -r test 2>&1 | Out-File -FilePath $log -Append -Encoding ascii
"test_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 3. build' | Out-File -FilePath $log -Append -Encoding ascii
& $pnpmCmd --filter @pi-wood/desktop build 2>&1 | Select-Object -Last 8 | Out-File -FilePath $log -Append -Encoding ascii
"build_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 4. probe:conversation (T8.1 regression, covers per-conversation event ownership)' | Out-File -FilePath $log -Append -Encoding ascii
& $pnpmCmd --filter @pi-wood/desktop probe:conversation 2>&1 | Select-Object -Last 4 | Out-File -FilePath $log -Append -Encoding ascii
"probe_conversation_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 5. ui-chat real conversation (envelope path: main wraps -> preload unwraps -> store routes)' | Out-File -FilePath $log -Append -Encoding ascii
$proofDir = 'C:\Users\1\Desktop\pi-wood\apps\desktop\docs\proofs\T8.2'
New-Item -ItemType Directory -Force $proofDir | Out-Null
$png = $proofDir + '\t82-ui-chat.png'
Set-Location C:\Users\1\Desktop\pi-wood\apps\desktop
$outLog = 'C:\Users\1\Desktop\pi-wood\scripts\t82-uichat.log'
$errLog = 'C:\Users\1\Desktop\pi-wood\scripts\t82-uichat.err'
$devArgs = @('exec', 'electron-vite', 'dev', '--', '--ui-chat', $png)
$p = Start-Process -FilePath $pnpmCmd -ArgumentList $devArgs -NoNewWindow -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
$exited = $p.WaitForExit(300000)
if (-not $exited) {
  'TIMEOUT_300S_KILLING' | Out-File -FilePath $log -Append -Encoding ascii
  Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill() } catch {} }
  Start-Sleep -Seconds 3
}
"uichat_exited=$exited png=$(Test-Path $png)" | Out-File -FilePath $log -Append -Encoding ascii
'== uichat key lines' | Out-File -FilePath $log -Append -Encoding ascii
Select-String -Path $outLog -Pattern 'engine-child|dropped|Error|captured|conversation' | ForEach-Object { $_.Line } | Select-Object -First 15 | Out-File -FilePath $log -Append -Encoding ascii

'== 6. restart dev instance' | Out-File -FilePath $log -Append -Encoding ascii
Start-Process -FilePath $pnpmCmd -ArgumentList '--filter','@pi-wood/desktop','dev' -WindowStyle Normal
"DONE $(Get-Date -Format o)" | Out-File -FilePath $log -Append -Encoding ascii
'GATE FINISHED' | Out-File -FilePath $log -Append -Encoding ascii
