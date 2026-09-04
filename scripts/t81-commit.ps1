$ErrorActionPreference = 'Continue'
Set-Location C:\Users\1\Desktop\pi-wood
$log = 'C:\Users\1\Desktop\pi-wood\scripts\t81-commit.log'
'== stage + commit T8.1' | Out-File -FilePath $log -Encoding ascii

Add-Content -Path scripts\t81-pathspec.txt -Value "scripts/t81-pathspec.txt`nscripts/t81-commit-msg.txt`nscripts/t81-commit.ps1"
git add --pathspec-from-file=scripts/t81-pathspec.txt 2>&1 | Out-File -FilePath $log -Append -Encoding ascii
"add_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii
'== staged stat' | Out-File -FilePath $log -Append -Encoding ascii
git diff --cached --stat | Select-Object -Last 6 | Out-File -FilePath $log -Append -Encoding ascii
'== commit' | Out-File -FilePath $log -Append -Encoding ascii
git commit -F scripts\t81-commit-msg.txt 2>&1 | Select-Object -Last 8 | Out-File -FilePath $log -Append -Encoding ascii
"commit_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii
git log --oneline -1 | Out-File -FilePath $log -Append -Encoding ascii

'== restart dev instance (leave env as found)' | Out-File -FilePath $log -Append -Encoding ascii
$pnpmCmd = 'C:\Users\1\AppData\Roaming\npm\pnpm.cmd'
Start-Process -FilePath $pnpmCmd -ArgumentList '--filter','@pi-wood/desktop','dev' -WindowStyle Normal
'started' | Out-File -FilePath $log -Append -Encoding ascii
'COMMIT FINISHED' | Out-File -FilePath $log -Append -Encoding ascii
