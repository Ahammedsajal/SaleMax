param([string]$MariaDbBin = 'C:\devstack\mariadb\mariadb-11.4.8-winx64\bin', [int]$Port = 3308)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $project "database\local-runtime\migration-tests-$Port"
$initializer = Join-Path $MariaDbBin 'mariadb-install-db.exe'
$server = Join-Path $MariaDbBin 'mysqld.exe'
foreach ($binary in @($initializer, $server)) { if (-not (Test-Path -LiteralPath $binary)) { throw 'MariaDB test binaries unavailable' } }
function Test-TestPort {
    $client = [System.Net.Sockets.TcpClient]::new()
    try { return $client.ConnectAsync('127.0.0.1', $Port).Wait(200) -and $client.Connected }
    catch { return $false }
    finally { $client.Dispose() }
}
if (Test-TestPort) { throw 'Test port is already occupied; refusing to use an existing database server' }
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$data = Join-Path $runtime 'data'
if (-not (Test-Path -LiteralPath $data)) {
    & $initializer "--datadir=$data" "--port=$Port" --silent *> (Join-Path $runtime 'initialize.log')
    if ($LASTEXITCODE -ne 0) { throw 'Disposable test database initialization failed' }
}
$instance = $null
$previous = @{}
foreach ($key in @('LOCAL_ONLY_MODE', 'DBHOST', 'DBPORT', 'DBUSER', 'DBPASS')) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
try {
    # This separate engine binds only loopback; no Windows service is installed.
    $instance = Start-Process -FilePath $server -ArgumentList @('--no-defaults', "--datadir=`"$data`"", '--bind-address=127.0.0.1', "--port=$Port", '--innodb-buffer-pool-size=64M', '--console') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'server.out.log') -RedirectStandardError (Join-Path $runtime 'server.err.log')
    $ready = $false
    for ($i=0; $i -lt 30; $i++) { if (Test-TestPort) { $ready=$true; break }; if ($instance.HasExited) { throw 'Disposable database exited during startup' }; Start-Sleep -Milliseconds 500 }
    if (-not $ready) { throw 'Disposable database did not become ready' }
    $env:LOCAL_ONLY_MODE='true'; $env:DBHOST='127.0.0.1'; $env:DBPORT="$Port"; $env:DBUSER='root'; $env:DBPASS=''
    Push-Location $project
    try { & node.exe 'tests/migrations.integration.js'; if ($LASTEXITCODE -ne 0) { throw 'Migration integration assertions failed' } }
    finally { Pop-Location }
} finally {
    foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
    if ($instance -and -not $instance.HasExited) { Stop-Process -Id $instance.Id; $instance.WaitForExit(10000) | Out-Null }
}
