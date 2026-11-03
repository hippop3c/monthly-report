[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$Workspace = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Python = 'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$FetchScript = Join-Path $Workspace 'outputs\01a0c1d5-a6fd-7252-a0d1-23864c1ef07b\daily_min_binding_20260901_20261102\fetch_and_summarize.py'
$Manifest = Join-Path $Workspace 'outputs\01a0c1d5-a6fd-7252-a0d1-23864c1ef07b\daily_min_binding_20260901_20261102\source_manifest.json'
$BuildScript = Join-Path $Workspace 'sites\idle-binding-monitor\build_data.py'
$BuiltData = Join-Path $Workspace 'sites\idle-binding-monitor\dist\data\alerts.json'
$RepoData = Join-Path $Repo 'dist\binding-clearance-alert\data\alerts.json'
$RepoPath = 'dist/binding-clearance-alert/data/alerts.json'
$TargetDate = (Get-Date).Date.AddDays(-1).ToString('yyyy-MM-dd')

foreach ($required in @($Python, $FetchScript, $BuildScript)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required updater file is missing: $required"
    }
}

& $Python $FetchScript
if ($LASTEXITCODE -ne 0) {
    throw "VDS download or daily-minimum calculation failed with exit code $LASTEXITCODE."
}

$manifestData = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifestData.period.end -ne $TargetDate) {
    throw "Calculated end date $($manifestData.period.end) does not match expected date $TargetDate."
}
$latestSources = @($manifestData.sources | Where-Object { $_.date -eq $TargetDate })
if ($latestSources.Count -ne 2) {
    throw "Expected two complete city files for $TargetDate; found $($latestSources.Count)."
}
foreach ($source in $latestSources) {
    $lastTimestamp = [datetime]$source.last_timestamp
    if ($lastTimestamp.ToString('HH:mm') -lt '23:30') {
        throw "The $($source.city) source for $TargetDate ends at $($source.last_timestamp)."
    }
}

& $Python $BuildScript
if ($LASTEXITCODE -ne 0) {
    throw "Dashboard data build failed with exit code $LASTEXITCODE."
}

$built = Get-Content -LiteralPath $BuiltData -Raw -Encoding UTF8 | ConvertFrom-Json
if ($built.meta.sourceEnd -ne $TargetDate) {
    throw "Dashboard source end $($built.meta.sourceEnd) does not match expected date $TargetDate."
}

Copy-Item -LiteralPath $BuiltData -Destination $RepoData -Force

$existingStaged = @(& git -C $Repo diff --cached --name-only)
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to inspect the monthly-report Git index.'
}
if ($existingStaged.Count -gt 0) {
    throw "Monthly-report already has staged changes; leaving them untouched: $($existingStaged -join ', ')"
}

& git -C $Repo add -- $RepoPath
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to stage the dashboard data file.'
}
$staged = @(& git -C $Repo diff --cached --name-only)
if ($staged.Count -eq 0) {
    Write-Output "No dashboard data change for $TargetDate."
    exit 0
}
if ($staged.Count -ne 1 -or $staged[0] -ne $RepoPath) {
    & git -C $Repo restore --staged -- $RepoPath
    throw "Unexpected staged paths detected; no commit was created: $($staged -join ', ')"
}

& git -C $Repo commit -m "Update binding monitor through $TargetDate"
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to commit the dashboard update.'
}
& git -C $Repo push origin main
if ($LASTEXITCODE -ne 0) {
    throw 'Git push failed; the local commit was preserved for retry.'
}

$verifyUrl = 'https://hippop3c.github.io/monthly-report/binding-clearance-alert/data/alerts.json'
$verified = $false
for ($attempt = 1; $attempt -le 20; $attempt++) {
    try {
        $online = Invoke-RestMethod -Uri "$verifyUrl?t=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -TimeoutSec 30
        if ($online.meta.sourceEnd -eq $TargetDate) {
            $verified = $true
            break
        }
    }
    catch {
        # GitHub Pages may still be deploying; retry below.
    }
    Start-Sleep -Seconds 15
}
if (-not $verified) {
    throw "GitHub push succeeded, but the published data did not reach $TargetDate within five minutes."
}

Write-Output "Binding monitor published through $TargetDate."
