$ErrorActionPreference = 'Continue'
Set-Location C:\Users\1\Desktop\pi-wood\apps\desktop
New-Item -ItemType Directory -Force C:\Users\1\Desktop\pi-wood\apps\desktop\docs\proofs\T8.1 | Out-Null
$out = 'C:\Users\1\Desktop\pi-wood\scripts\t81-uichat.log'
"START $(Get-Date -Format o)" | Out-File -FilePath $out -Encoding ascii

$png = 'C:\Users\1\Desktop\pi-wood\apps\desktop\docs\proofs\T8.1\t81-ui-chat.png'

$pnpmCmd = 'C:\Users\1\AppData\Roaming\npm\pnpm.cmd'
$p = Start-Process -FilePath $pnpmCmd -ArgumentList 'exec','electron-vite','dev','--','--ui-chat',$png -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError 'C:\Users\1\Desktop\pi-wood\scripts\t81-uichat.err'
$exited = $p.WaitForExit(300000)
if (-not $exited) {
  'TIMEOUT_300S_KILLING_ELECTRON' | Out-File -FilePath $out -Append -Encoding ascii
  Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill() } catch {} }
  Start-Sleep -Seconds 3
}
"dev_exit=$($p.ExitCode) exited=$exited" | Out-File -FilePath $out -Append -Encoding ascii
"png_exists=$(Test-Path $png)" | Out-File -FilePath $out -Append -Encoding ascii
'== engine/child lines ==' | Out-File -FilePath $out -Append -Encoding ascii
Select-String -Path $out -Pattern 'engine-child|conversation|utilityProcess|session_shutdown|Error|error|model_changed|agent_settled|captured' | ForEach-Object { $_.Line } | Select-Object -First 60 | Out-File -FilePath $out -Append -Encoding ascii
'UICHAT FINISHED' | Out-File -FilePath $out -Append -Encoding ascii
