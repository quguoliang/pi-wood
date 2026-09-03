# T8.0 P1-d packaged re-test: rebuild the --dir artifact with the new files/asarUnpack rules,
# then run the packaged exe headless and read its on-disk log (GUI-subsystem exe has no stdout).
$ErrorActionPreference = 'Continue'
$app = 'C:\Users\1\Desktop\pi-wood\apps\desktop'
$dir = Join-Path $app 'docs\proofs\T8.0'
$log = Join-Path $dir 'packaged-rerun.log'
"=== packaged rerun start $(Get-Date -Format o) ===" | Out-File $log -Encoding utf8

Set-Location $app
pnpm package:dir *>> $log
"PKGDIR_EXIT=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

$exe = Join-Path $app 'release\win-unpacked\pi-wood.exe'
if (Test-Path $exe) {
  # -Wait is required: a GUI-subsystem exe returns immediately otherwise
  Start-Process -FilePath $exe -ArgumentList '--engine-process-probe=packaged' -Wait
  "EXE_STARTED=1" | Out-File $log -Append -Encoding utf8
} else {
  "EXE_STARTED=0 (no artifact)" | Out-File $log -Append -Encoding utf8
}
"=== packaged rerun done $(Get-Date -Format o) ===" | Out-File $log -Append -Encoding utf8
