param([string]$Version='1.1.2')
$ErrorActionPreference='Stop'
if($Version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version'}
$projectDir=Split-Path -Parent $PSScriptRoot
$workspaceDir=Split-Path -Parent $projectDir
$outputDir=Join-Path $projectDir '.local\releases'
$stageDir=Join-Path $outputDir ('stage-'+[Guid]::NewGuid().ToString('N'))
$packageDir=Join-Path $stageDir '团队赛策略台'
$packageProject=Join-Path $packageDir 'team-strategy'
$packageRuntime=Join-Path $packageProject 'runtime'
New-Item -ItemType Directory -Force -Path $packageRuntime | Out-Null
Copy-Item -LiteralPath (Join-Path $workspaceDir '团队赛策略台.exe') -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $projectDir 'dist') -Destination $packageProject -Recurse
Copy-Item -LiteralPath (Join-Path $projectDir 'serve.cjs') -Destination $packageProject
Copy-Item -LiteralPath (Join-Path $projectDir 'runtime\node.exe') -Destination $packageRuntime
Copy-Item -LiteralPath (Join-Path $projectDir 'runtime\node-LICENSE.txt') -Destination $packageRuntime
$exampleFile=Join-Path $projectDir 'examples\团队赛胜率填写示例.xlsx'
$packageExample=Join-Path $packageDir '团队赛胜率填写示例.xlsx'
if(-not(Test-Path -LiteralPath $exampleFile)){throw 'Onboarding example workbook is missing'}
Copy-Item -LiteralPath $exampleFile -Destination $packageExample
$instructions=@"
团队赛策略台 Windows 便携版 $Version

1. 完整解压压缩包，再双击“团队赛策略台.exe”。无需终端，无需另装 Node.js。
2. 请保留 EXE 与 team-strategy 文件夹的相对位置，不要只取出 EXE。
3. 首次未导入真实胜率时，界面显示随机示例，不能作为实战依据。
4. 可导入 Excel/JSON，也可在控制台编辑胜率并点击“保存 Excel”创建表格。
5. 自动锚定文件为 EXE 同目录的“团队赛卡组对局分析.xlsx”。此分发包不包含私人胜率表。
6. 胜率与默认设置自动保存到 team-strategy/.local/state.json。覆盖 Excel 前会备份原文件。
7. 直接打开 team-strategy/dist/index.html 也可手动使用，但自动读取 Excel、项目文件保存需要 EXE 启动。
8. 本程序只监听本机，数据留在本机。迁移时复制整个文件夹，私有记录请自行保管。
9. 随包附带“团队赛胜率填写示例.xlsx”，先阅读第三页填写说明。所有示例数据均为虚构；改好后可导入，或将副本改名为默认锚定文件。

Node.js 许可证：team-strategy/runtime/node-LICENSE.txt
fflate 许可证：team-strategy/dist/vendor/fflate-LICENSE.txt
"@
$instructions | Set-Content -LiteralPath (Join-Path $packageDir '使用说明.txt') -Encoding UTF8
$privateFiles=Get-ChildItem -LiteralPath $packageDir -File -Recurse | Where-Object { ($_.Extension -eq '.xlsx' -and $_.FullName -ne $packageExample) -or $_.Extension -in '.jks','.keystore','.p12','.pfx' -or $_.Name -in 'state.json','password.txt' }
if($privateFiles){throw 'Private files found in distribution'}
$zipPath=Join-Path $outputDir "team-strategy-windows-v$Version.zip"
Compress-Archive -LiteralPath $packageDir -DestinationPath $zipPath -CompressionLevel Optimal -Force
Write-Output "Package: $zipPath"
Write-Output "Staged app: $packageDir"
Get-Item -LiteralPath $zipPath | Select-Object Name,Length
