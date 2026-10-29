$ErrorActionPreference='Stop'
$mobileDir=$PSScriptRoot
$projectDir=Split-Path -Parent $mobileDir
$outputDir=Split-Path -Parent $projectDir
$toolDir=Join-Path $mobileDir '.toolchain'
$jdkDir=(Get-ChildItem -LiteralPath (Join-Path $toolDir 'jdk') -Directory | Select-Object -First 1).FullName
$buildTools=(Get-ChildItem -LiteralPath (Join-Path $toolDir 'build-tools') -Directory | Select-Object -First 1).FullName
$androidJar=Join-Path $toolDir 'platform\android-35\android.jar'
$buildDir=Join-Path $mobileDir '.build'
$assetDir=Join-Path $buildDir 'assets'
foreach($folder in @($buildDir,$assetDir,(Join-Path $buildDir 'classes'),(Join-Path $buildDir 'dex'),(Join-Path $buildDir 'gen'))){New-Item -ItemType Directory -Force -Path $folder | Out-Null}
function Run-Tool([string]$exe,[string[]]$arguments){ & $exe @arguments; if($LASTEXITCODE -ne 0){throw "Build command failed: $exe"} }
Get-ChildItem -LiteralPath (Join-Path $projectDir 'dist') -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $assetDir -Force }
Copy-Item -LiteralPath (Join-Path $projectDir 'dist\vendor') -Destination $assetDir -Recurse -Force
# JavaScript source is shared with the PC version.
Run-Tool (Join-Path $buildTools 'aapt2.exe') @('compile','--dir',(Join-Path $mobileDir 'android\res'),'-o',(Join-Path $buildDir 'resources.zip'))
Run-Tool (Join-Path $buildTools 'aapt2.exe') @('link','-o',(Join-Path $buildDir 'base.apk'),'--manifest',(Join-Path $mobileDir 'android\AndroidManifest.xml'),'-I',$androidJar,'--java',(Join-Path $buildDir 'gen'),'-A',$assetDir,(Join-Path $buildDir 'resources.zip'))
$javaSources=@(Get-ChildItem -LiteralPath (Join-Path $mobileDir 'android\src'),(Join-Path $buildDir 'gen') -Filter '*.java' -File -Recurse | ForEach-Object FullName)
Run-Tool (Join-Path $jdkDir 'bin\javac.exe') (@('-encoding','UTF-8','-source','8','-target','8','-classpath',$androidJar,'-d',(Join-Path $buildDir 'classes'))+$javaSources)
Run-Tool (Join-Path $jdkDir 'bin\jar.exe') @('cf',(Join-Path $buildDir 'classes.jar'),'-C',(Join-Path $buildDir 'classes'),'.')
Run-Tool (Join-Path $jdkDir 'bin\java.exe') @('-cp',(Join-Path $buildTools 'lib\d8.jar'),'com.android.tools.r8.D8','--lib',$androidJar,'--min-api','26','--output',(Join-Path $buildDir 'dex'),(Join-Path $buildDir 'classes.jar'))
Run-Tool (Join-Path $jdkDir 'bin\jar.exe') @('uf',(Join-Path $buildDir 'base.apk'),'-C',(Join-Path $buildDir 'dex'),'classes.dex')
Run-Tool (Join-Path $buildTools 'zipalign.exe') @('-f','4',(Join-Path $buildDir 'base.apk'),(Join-Path $buildDir 'aligned.apk'))
$signingDir=Join-Path $mobileDir '.signing';New-Item -ItemType Directory -Force -Path $signingDir | Out-Null
$keyFile=Join-Path $signingDir 'local-release.jks';$passwordFile=Join-Path $signingDir 'password.txt'
if(-not(Test-Path -LiteralPath $keyFile)){
    $passwordBytes=New-Object byte[] 24;[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($passwordBytes)
    [System.IO.File]::WriteAllText($passwordFile,[Convert]::ToBase64String($passwordBytes),[System.Text.Encoding]::ASCII)
    Run-Tool (Join-Path $jdkDir 'bin\keytool.exe') @('-genkeypair','-keystore',$keyFile,'-storepass:file',$passwordFile,'-keypass:file',$passwordFile,'-alias','strategy','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Team Strategy Local','-noprompt')
}
$apkFile=Join-Path $outputDir '团队赛策略台-安卓.apk'
Run-Tool (Join-Path $jdkDir 'bin\java.exe') @('-jar',(Join-Path $buildTools 'lib\apksigner.jar'),'sign','--ks',$keyFile,'--ks-pass',('file:'+$passwordFile),'--out',$apkFile,(Join-Path $buildDir 'aligned.apk'))
Run-Tool (Join-Path $jdkDir 'bin\java.exe') @('-jar',(Join-Path $buildTools 'lib\apksigner.jar'),'verify','--verbose',$apkFile)
Write-Output "Built: $apkFile"
