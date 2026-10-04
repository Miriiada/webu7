param([ValidateSet('build','start','test','setup','sync')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$bundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$nodeCandidates = @((Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source), $bundledNode)
$runtime = $null
foreach ($candidate in $nodeCandidates) {
  if ($candidate -and (Test-Path -LiteralPath $candidate)) {
    $version = & $candidate --version
    if ($version -match '^v(\d+)' -and [int]$Matches[1] -ge 24) { $runtime = $candidate; break }
  }
}
if (!$runtime) { throw 'Install Node.js 24 LTS and try again.' }
function Invoke-NodeTask([string[]]$TaskArgs) {
  & $runtime @TaskArgs
  if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" }
}
if ($Action -in @('build','test','setup','sync')) { Invoke-NodeTask @('node_modules/typescript/bin/tsc','-p','tsconfig.server.json') }
switch ($Action) {
  'build' { Invoke-NodeTask @('node_modules/typescript/bin/tsc','--noEmit'); Invoke-NodeTask @('node_modules/vite/bin/vite.js','build','--configLoader','native') }
  'test' { Invoke-NodeTask @('--test','build-server/tests/*.test.js') }
  'setup' { Invoke-NodeTask @('build-server/scripts/admin.js','setup') }
  'sync' { Invoke-NodeTask @('build-server/scripts/sync-content.js') }
  'start' { Invoke-NodeTask @('build-server/server/index.js') }
}
