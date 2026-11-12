param(
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [string]$Time = "09:00",
  [string]$TaskName = "YuqueSync_Obsidian",
  [switch]$Remove,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if ($Remove) {
  schtasks /delete /tn $TaskName /f 2>&1 | Out-String | Write-Host
  Write-Host "Removed task $TaskName"
  exit 0
}

$ConfigPath = (Resolve-Path $ConfigPath).Path
if ($Time -notmatch "^\d{1,2}:\d{2}$") { throw "-Time must look like 09:00, got: $Time" }

# A scheduled task gets a minimal PATH: pin the absolute node.exe instead of trusting "node".
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node not found in PATH. Install Node.js >= 18 first." }

$syncScript = Join-Path $PSScriptRoot "sync.mjs"
if (-not (Test-Path $syncScript)) { throw "sync.mjs not found next to install-task.ps1" }

$cfg = Get-Content -Raw -Encoding UTF8 $ConfigPath | ConvertFrom-Json
if (-not $cfg.vault) { throw "config has no vault field" }

# cmd.exe expands %VAR% inside quotes too, so a literal % must be written as %%.
function Esc([string]$s) { $s.Replace("%", "%%") }

$parent = Split-Path $ConfigPath -Parent
$batPath = Join-Path $parent "sync-yuque.bat"
$outPath = Join-Path $parent "sync.out.log"

$q = '"'
$run = $q + (Esc $node) + $q + " " + $q + (Esc $syncScript) + $q + " --config=" + $q + (Esc $ConfigPath) + $q + " >> " + $q + (Esc $outPath) + $q + " 2>&1"
$lines = @(
  "@echo off",
  "chcp 65001 >nul",
  'cd /d "%~dp0"',
  $run
)
# UTF-8 without BOM + the chcp line above: ANSI/ASCII silently corrupts Chinese paths into "?"
[IO.File]::WriteAllText($batPath, ($lines -join "`r`n") + "`r`n", (New-Object System.Text.UTF8Encoding $false))
Write-Host "wrote $batPath"
$tr = $q + $batPath + $q

if ($DryRun) {
  Write-Host "dry run, nothing registered:"
  Write-Host "  schtasks /create /tn $TaskName /tr $tr /sc daily /st $Time /f"
  exit 0
}

schtasks /create /tn $TaskName /tr $tr /sc daily /st $Time /f 2>&1 | Out-String | Write-Host
schtasks /query /tn $TaskName /v /fo LIST 2>&1 | Out-String | Write-Host
Write-Host ""
Write-Host "Task To Run must point at: $batPath"
