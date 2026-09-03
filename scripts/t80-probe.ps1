# T8.0 probe runner (ASCII-only: Windows PowerShell 5.1 decodes BOM-less UTF-8 as ANSI).
# Probe logs are written by the probes themselves (UTF-8 from Node) under apps/desktop/docs/proofs/T8.0.
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\1\Desktop\pi-wood'
$dir = Join-Path $root 'apps\desktop\docs\proofs\T8.0'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$log = Join-Path $dir 'runner.log'
"=== T8.0 probes start $(Get-Date -Format o) ===" | Out-File $log -Encoding utf8

Set-Location (Join-Path $root 'apps\desktop')

"--- P2 worktree probe (plain node) ---" | Out-File $log -Append -Encoding utf8
pnpm probe:worktree *>> $log
"WORKTREE_EXIT=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

"--- P1 engine-process probe (electron, dev form) ---" | Out-File $log -Append -Encoding utf8
pnpm probe:engine-process *>> $log
"ENGINE_EXIT=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

"--- P1-d packaged form (rebuild the --dir artifact so it contains the probe, then run its exe) ---" | Out-File $log -Append -Encoding utf8
pnpm package:dir *>> $log
"PKGDIR_EXIT=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8
$exe = Join-Path (Get-Location) 'release\win-unpacked\pi-wood.exe'
if (Test-Path $exe) {
  & $exe --engine-process-probe=packaged *>> $log
  "PACKAGED_EXIT=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8
} else {
  "PACKAGED_EXIT=skipped (no win-unpacked artifact)" | Out-File $log -Append -Encoding utf8
}

"=== T8.0 probes done $(Get-Date -Format o) ===" | Out-File $log -Append -Encoding utf8
