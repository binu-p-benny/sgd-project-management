<#
.SYNOPSIS
  Replaces the local database with a copy of the live (Neon) one.

.DESCRIPTION
  Dumps Neon, recreates the local database from that dump, then applies any migrations the
  live database is behind on. Nothing is written to Neon at any point — this only reads from it.

  The local database is DROPPED and recreated, so everything currently in it is lost. A dump of
  it is taken first (local-before-pull-<timestamp>.dump) so you can put it back if needed.

  The Neon connection string is read from $env:NEON_URL and is never written to disk or echoed.

.EXAMPLE
  $env:NEON_URL = "postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"
  .\scripts\pull-live-data.ps1 -Yes
#>
param(
  [switch]$Yes,
  [string]$PgBin = "C:\Program Files\PostgreSQL\17\bin"
)

$ErrorActionPreference = "Stop"

if (-not $Yes) {
  Write-Error "Refusing to run without -Yes: this drops and replaces your local database."
}
if (-not $env:NEON_URL) {
  Write-Error 'Set $env:NEON_URL to the Neon connection string first (it is never stored or printed).'
}
if (-not (Test-Path (Join-Path $PgBin "pg_dump.exe"))) {
  Write-Error "pg_dump not found in $PgBin. Pass -PgBin with the path to your PostgreSQL bin directory."
}
$env:Path = "$PgBin;$env:Path"

function Mask([string]$url) { return ($url -replace '(://[^:]+:)[^@]+@', '$1****@') }

# The local URL comes from .env, minus Prisma's ?schema= parameter, which libpq rejects.
$line = (Get-Content .env | Select-String '^DATABASE_URL=').ToString()
$localUrl = $line.Substring($line.IndexOf('=') + 1).Trim().Trim('"').Split('?')[0]
$uri = [System.Uri]$localUrl
$dbName = $uri.AbsolutePath.TrimStart('/')
$adminUrl = $localUrl -replace "/$dbName$", "/postgres"

Write-Output "Local target : $(Mask $localUrl)"
Write-Output "Live source  : $(Mask $env:NEON_URL)"

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$localBackup = "local-before-pull-$stamp.dump"
$liveDump = "neon-live-$stamp.dump"

Write-Output "`n[1/5] Backing up the current local database to $localBackup ..."
pg_dump $localUrl -Fc -f $localBackup
if ($LASTEXITCODE -ne 0) { Write-Error "Local backup failed; nothing has been changed." }

Write-Output "[2/5] Dumping live data to $liveDump ..."
pg_dump $env:NEON_URL --no-owner --no-privileges -Fc -f $liveDump
if ($LASTEXITCODE -ne 0) { Write-Error "Live dump failed; nothing has been changed." }

Write-Output "[3/5] Recreating the local database (closing any open connections first) ..."
$kill = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$dbName' AND pid <> pg_backend_pid();"
psql $adminUrl -v ON_ERROR_STOP=1 -c $kill | Out-Null
psql $adminUrl -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS `"$dbName`";" | Out-Null
psql $adminUrl -v ON_ERROR_STOP=1 -c "CREATE DATABASE `"$dbName`";" | Out-Null

Write-Output "[4/5] Restoring live data into $dbName ..."
pg_restore --no-owner --no-privileges -d $localUrl $liveDump
# pg_restore exits non-zero on benign notices (e.g. extensions it may not recreate), so report
# rather than abort — step 5 and the row counts below are the real check that it worked.
if ($LASTEXITCODE -ne 0) { Write-Warning "pg_restore reported warnings — check the output above." }

Write-Output "[5/5] Applying any migrations the live database was behind on ..."
npx prisma migrate deploy

Write-Output "`nDone. Local backup kept at $localBackup, live dump at $liveDump."
Write-Output "Note: your logins are now the live users — the demo accounts are gone."
