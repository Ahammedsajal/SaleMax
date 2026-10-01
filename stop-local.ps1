$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$runtime = Join-Path $root 'database\local-runtime'
$envLines = Get-Content -LiteralPath (Join-Path $root '.env')
function Get-LocalSetting([string]$key) {
  $line = $envLines | Where-Object { $_.StartsWith("$key=") } | Select-Object -First 1
  if (-not $line) { throw "Missing local setting: $key" }
  return $line.Substring($key.Length + 1)
}
$escapedRoot = [regex]::Escape($root)
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match $escapedRoot -and $_.CommandLine -match 'server\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$dbAdmin = 'C:\devstack\mariadb\mariadb-11.4.8-winx64\bin\mariadb-admin.exe'
$rootPass = Get-LocalSetting 'LOCAL_DB_ROOT_PASSWORD'
& $dbAdmin --protocol=tcp --host=127.0.0.1 --port=3307 --user=root "--password=$rootPass" shutdown *> $null
Write-Output 'Stopped the local SaleMaX Node and MariaDB processes.'
