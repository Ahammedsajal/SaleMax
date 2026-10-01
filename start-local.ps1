$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$runtime = Join-Path $root 'database\local-runtime'
$ini = Join-Path $runtime 'my.ini'
$dbDir = 'C:\devstack\mariadb\mariadb-11.4.8-winx64\bin'
$mysql = Join-Path $dbDir 'mariadb.exe'
$mysqld = Join-Path $dbDir 'mysqld.exe'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$envLines = Get-Content -LiteralPath (Join-Path $root '.env')
function Get-LocalSetting([string]$key) {
  $line = $envLines | Where-Object { $_.StartsWith("$key=") } | Select-Object -First 1
  if (-not $line) { throw "Missing local setting: $key" }
  return $line.Substring($key.Length + 1)
}
function Test-LocalPort([int]$port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try { $task = $client.ConnectAsync('127.0.0.1', $port); return $task.Wait(500) -and $client.Connected }
  catch { return $false }
  finally { $client.Dispose() }
}
if (-not (Test-LocalPort 3307)) {
  $dbOut = Join-Path $runtime 'mysqld.out.log'
  Start-Process -FilePath $mysqld -ArgumentList @("--defaults-file=`"$ini`"", '--console') -WorkingDirectory (Split-Path $dbDir -Parent) -WindowStyle Hidden -RedirectStandardOutput $dbOut -RedirectStandardError (Join-Path $runtime 'mysqld.err.log') | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 90; $i++) { if (Test-LocalPort 3307) { $ready = $true; break }; Start-Sleep -Seconds 1 }
  if (-not $ready) { throw "Local MariaDB failed to start. See $dbOut" }
}
$dbuser = Get-LocalSetting 'DBUSER'
$dbpass = Get-LocalSetting 'DBPASS'
$dbname = Get-LocalSetting 'DBNAME'
& $mysql --protocol=tcp --host=127.0.0.1 --port=3307 --user=$dbuser "--password=$dbpass" "--database=$dbname" --execute='SELECT 1' *> $null
if ($LASTEXITCODE -ne 0) { throw 'Local database check failed.' }
if (-not (Test-LocalPort 3010)) {
  $log = Join-Path $runtime 'node.out.log'
  $err = Join-Path $runtime 'node.err.log'
  Start-Process -FilePath $node -ArgumentList @('"' + (Join-Path $root 'server.js') + '"') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 180; $i++) { if (Test-LocalPort 3010) { $ready = $true; break }; Start-Sleep -Seconds 1 }
  if (-not $ready) { throw "Local SaleMaX did not listen on port 3010. See $err" }
}
Write-Output 'SaleMaX Node is running locally at http://127.0.0.1:3010'



