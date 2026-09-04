$ErrorActionPreference = 'Continue'
Set-Location C:\Users\1\Desktop\pi-wood\apps\desktop
$log = 'C:\Users\1\Desktop\pi-wood\scripts\t81-packaged.log'
$pnpmCmd = 'C:\Users\1\AppData\Roaming\npm\pnpm.cmd'

'== A. package:dir' | Out-File -FilePath $log -Encoding ascii
& $pnpmCmd package:dir 2>&1 | Select-Object -Last 20 | Out-File -FilePath $log -Append -Encoding ascii
"packagedir_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== B. asar contents (engine-child present?)' | Out-File -FilePath $log -Append -Encoding ascii
& $pnpmCmd exec asar list resources\app.asar 2>&1 | Select-String -Pattern 'engine-child|out/main' | Select-Object -First 10 | Out-File -FilePath $log -Append -Encoding ascii
"asar_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== C. run packaged conversation probe' | Out-File -FilePath $log -Append -Encoding ascii
$exe = 'C:\Users\1\Desktop\pi-wood\apps\desktop\release\win-unpacked\pi-wood.exe'
if (Test-Path $exe) {
  $pp = Start-Process -FilePath $exe -ArgumentList '--conversation-probe=packaged' -Wait -PassThru
  "probe_launched=True probe_exit=$($pp.ExitCode)" | Out-File -FilePath $log -Append -Encoding ascii
} else {
  "probe_launched=False (no exe)" | Out-File -FilePath $log -Append -Encoding ascii
}
$proof = 'C:\Users\1\Desktop\pi-wood\apps\desktop\release\win-unpacked\T8.1-proofs\conversation-probe.txt'
"proof_exists=$(Test-Path $proof)" | Out-File -FilePath $log -Append -Encoding ascii
if (Test-Path $proof) {
  Get-Content $proof | Out-File -FilePath $log -Append -Encoding ascii
}
'PACKAGED FINISHED' | Out-File -FilePath $log -Append -Encoding ascii
