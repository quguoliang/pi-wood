$ErrorActionPreference = 'Continue'
Set-Location C:\Users\1\Desktop\pi-wood
$log = 'C:\Users\1\Desktop\pi-wood\scripts\t83-gate.log'
$pnpmCmd = 'C:\Users\1\AppData\Roaming\npm\pnpm.cmd'
"START $(Get-Date -Format o)" | Out-File -FilePath $log -Encoding ascii

# ASCII-only file (PS 5.1 reads BOM-less UTF-8 as ANSI -> ParserError).

'== 0. kill stray electron' | Out-File -FilePath $log -Append -Encoding ascii
Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill(); $_.WaitForExit(5000) } catch {} }
Start-Sleep -Seconds 2

'== 1. typecheck' | Out-File -FilePath $log -Append -Encoding ascii
& $pnpmCmd -r typecheck 2>&1 | Out-File -FilePath $log -Append -Encoding ascii
"typecheck_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 2. test' | Out-File -FilePath $log -Append -Encoding ascii
& $pnpmCmd -r test 2>&1 | Out-File -FilePath $log -Append -Encoding ascii
"test_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 3. build' | Out-File -FilePath $log -Append -Encoding ascii
& $pnpmCmd --filter @pi-wood/desktop build 2>&1 | Select-Object -Last 6 | Out-File -FilePath $log -Append -Encoding ascii
"build_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 4. probe:conversation (now includes C8 outbound throttle)' | Out-File -FilePath $log -Append -Encoding ascii
& $pnpmCmd --filter @pi-wood/desktop probe:conversation 2>&1 | Select-Object -Last 4 | Out-File -FilePath $log -Append -Encoding ascii
"probe_conversation_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== 5. ui-chat (real model, store migration end-to-end)' | Out-File -FilePath $log -Append -Encoding ascii
$proofDir = 'C:\Users\1\Desktop\pi-wood\apps\desktop\docs\proofs\T8.3'
New-Item -ItemType Directory -Force $proofDir | Out-Null
$png = $proofDir + '\t83-ui-chat.png'
Set-Location C:\Users\1\Desktop\pi-wood\apps\desktop
$outLog = 'C:\Users\1\Desktop\pi-wood\scripts\t83-uichat.log'
$errLog = 'C:\Users\1\Desktop\pi-wood\scripts\t83-uichat.err'
$devArgs = @('exec', 'electron-vite', 'dev', '--', '--ui-chat', $png)
$p = Start-Process -FilePath $pnpmCmd -ArgumentList $devArgs -NoNewWindow -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
$exited = $p.WaitForExit(300000)
if (-not $exited) {
  'TIMEOUT_300S_KILLING' | Out-File -FilePath $log -Append -Encoding ascii
  Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill() } catch {} }
  Start-Sleep -Seconds 3
}
"uichat_exited=$exited png=$(Test-Path $png)" | Out-File -FilePath $log -Append -Encoding ascii

'== 6. capture (empty-state UI after 15-file store migration)' | Out-File -FilePath $log -Append -Encoding ascii
$png2 = $proofDir + '\t83-capture.png'
$devArgs2 = @('exec', 'electron-vite', 'dev', '--', '--capture', $png2)
$p2 = Start-Process -FilePath $pnpmCmd -ArgumentList $devArgs2 -NoNewWindow -PassThru -RedirectStandardOutput 'C:\Users\1\Desktop\pi-wood\scripts\t83-capture.log' -RedirectStandardError 'C:\Users\1\Desktop\pi-wood\scripts\t83-capture.err'
$exited2 = $p2.WaitForExit(120000)
if (-not $exited2) {
  'capture_timeout_killing' | Out-File -FilePath $log -Append -Encoding ascii
  Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill() } catch {} }
  Start-Sleep -Seconds 3
}
"capture_exited=$exited2 png=$(Test-Path $png2)" | Out-File -FilePath $log -Append -Encoding ascii

'== 7. restart dev instance' | Out-File -FilePath $log -Append -Encoding ascii
Start-Process -FilePath $pnpmCmd -ArgumentList '--filter','@pi-wood/desktop','dev' -WindowStyle Normal
"DONE $(Get-Date -Format o)" | Out-File -FilePath $log -Append -Encoding ascii
'GATE FINISHED' | Out-File -FilePath $log -Append -Encoding ascii
