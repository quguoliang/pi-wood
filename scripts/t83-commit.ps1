$ErrorActionPreference = 'Continue'
Set-Location C:\Users\1\Desktop\pi-wood
$log = 'C:\Users\1\Desktop\pi-wood\scripts\t83-commit.log'

# ASCII-only: PS 5.1 reads BOM-less UTF-8 as ANSI and fails to parse CJK comments.
# t83-pathspec.txt is written UTF-8/LF from the sandbox because it carries the CJK plan-file name.

'== stage + commit T8.3' | Out-File -FilePath $log -Encoding ascii
git add --pathspec-from-file=scripts/t83-pathspec.txt 2>&1 | Out-File -FilePath $log -Append -Encoding ascii
"add_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii
git diff --cached --stat | Select-Object -Last 4 | Out-File -FilePath $log -Append -Encoding ascii
git commit -F scripts/t83-commit-msg.txt 2>&1 | Select-Object -Last 4 | Out-File -FilePath $log -Append -Encoding ascii
"commit_exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding ascii
git log --oneline -1 | Out-File -FilePath $log -Append -Encoding ascii
'COMMIT FINISHED' | Out-File -FilePath $log -Append -Encoding ascii
