$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$outputDir = Split-Path -Parent $projectDir
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$sourcePath = Join-Path $PSScriptRoot 'Launcher.cs'
$outputPath = Join-Path $outputDir '团队赛策略台.exe'
& $compilerPath /nologo /target:winexe "/out:$outputPath" /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll $sourcePath
if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed.' }
Write-Output "Built: $outputPath"
