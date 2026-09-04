$ErrorActionPreference = 'Continue'
Set-Location C:\Users\1\Desktop\pi-wood\apps\desktop
$pnpmCmd = 'C:\Users\1\AppData\Roaming\npm\pnpm.cmd'
& $pnpmCmd probe:conversation 2>&1 | Out-File -FilePath 'C:\Users\1\Desktop\pi-wood\scripts\t83-probe.log' -Encoding ascii
"probe_exit=$LASTEXITCODE" | Out-File -FilePath 'C:\Users\1\Desktop\pi-wood\scripts\t83-probe.log' -Append -Encoding ascii
'PROBE DONE' | Out-File -FilePath 'C:\Users\1\Desktop\pi-wood\scripts\t83-probe.log' -Append -Encoding ascii
