$ErrorActionPreference = 'Continue'
Set-Location C:\Users\1\Desktop\pi-wood
$log = 'C:\Users\1\Desktop\pi-wood\scripts\t81-probe-types.log'
"START $(Get-Date -Format o)" | Out-File -FilePath $log -Encoding ascii

'== root node_modules/@types listing' | Out-File -FilePath $log -Append -Encoding ascii
if (Test-Path C:\Users\1\Desktop\pi-wood\node_modules\@types) { Get-ChildItem C:\Users\1\Desktop\pi-wood\node_modules\@types -Name | Out-File -FilePath $log -Append -Encoding ascii } else { 'NO root node_modules/@types' | Out-File -FilePath $log -Append -Encoding ascii }
'== engine node_modules/@types listing' | Out-File -FilePath $log -Append -Encoding ascii
if (Test-Path C:\Users\1\Desktop\pi-wood\packages\engine\node_modules\@types) { Get-ChildItem C:\Users\1\Desktop\pi-wood\packages\engine\node_modules\@types -Name | Out-File -FilePath $log -Append -Encoding ascii } else { 'NO engine node_modules/@types' | Out-File -FilePath $log -Append -Encoding ascii }

'== git HEAD version of engine typecheck (stash-free check: run on current tree)' | Out-File -FilePath $log -Append -Encoding ascii
pnpm --filter @pi-wood/engine typecheck 2>&1 | Out-File -FilePath $log -Append -Encoding ascii
"engine_typecheck_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== engine test (after as-cast fix)' | Out-File -FilePath $log -Append -Encoding ascii
pnpm --filter @pi-wood/engine test 2>&1 | Select-Object -Last 25 | Out-File -FilePath $log -Append -Encoding ascii
"engine_test_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'== ipc-schema test (frame codec)' | Out-File -FilePath $log -Append -Encoding ascii
pnpm --filter @pi-wood/ipc-schema test 2>&1 | Select-Object -Last 20 | Out-File -FilePath $log -Append -Encoding ascii
"ipc_test_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii

'DONE' | Out-File -FilePath $log -Append -Encoding ascii
