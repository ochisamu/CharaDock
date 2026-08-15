@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "CHARADOCK_NODE=C:\Program Files\nodejs\node.exe"
if not exist "%CHARADOCK_NODE%" (
  set "CHARADOCK_NODE="
  for /f "delims=" %%N in ('where node 2^>nul') do if not defined CHARADOCK_NODE set "CHARADOCK_NODE=%%N"
)
if not defined CHARADOCK_NODE (
  echo Windows node.exe was not found. 1>&2
  exit /b 1
)

set "CHARADOCK_NPM=%~dp0npm.cmd"
set "CHARADOCK_NPM=%CHARADOCK_NODE:node.exe=npm.cmd%"
if not exist "%CHARADOCK_NPM%" (
  set "CHARADOCK_NPM="
  for /f "delims=" %%N in ('where npm.cmd 2^>nul') do if not defined CHARADOCK_NPM set "CHARADOCK_NPM=%%N"
)
set "CHARADOCK_NPX=%CHARADOCK_NODE:node.exe=npx.cmd%"
if not exist "%CHARADOCK_NPX%" (
  set "CHARADOCK_NPX="
  for /f "delims=" %%N in ('where npx.cmd 2^>nul') do if not defined CHARADOCK_NPX set "CHARADOCK_NPX=%%N"
)

pushd "%~dp0..\..\..\.." || exit /b 1
if not exist "node_modules\electron-builder\out\cli\cli.js" (
  echo electron-builder dependencies are missing. Run npm install in WSL first. 1>&2
  popd
  exit /b 1
)

if not exist "node_modules\sherpa-onnx-win-x64\sherpa-onnx.node" (
  if not defined CHARADOCK_NPM (
    echo Windows npm.cmd is required to install the sherpa-onnx Windows native addon. 1>&2
    popd
    exit /b 1
  )
  set "CHARADOCK_SHERPA_VERSION_FILE=%TEMP%\charadock-sherpa-version-%RANDOM%-%RANDOM%.txt"
  "%CHARADOCK_NODE%" -p "require('./node_modules/sherpa-onnx-node/package.json').version" > "!CHARADOCK_SHERPA_VERSION_FILE!"
  set /p CHARADOCK_SHERPA_VERSION=<"!CHARADOCK_SHERPA_VERSION_FILE!"
  del /q "!CHARADOCK_SHERPA_VERSION_FILE!" >nul 2>&1
  if not defined CHARADOCK_SHERPA_VERSION (
    echo Could not resolve the installed sherpa-onnx-node version. 1>&2
    popd
    exit /b 1
  )
  set "CHARADOCK_SHERPA_ARCHIVE=%TEMP%\sherpa-onnx-win-x64-!CHARADOCK_SHERPA_VERSION!.tgz"
  echo Fetching sherpa-onnx-win-x64 !CHARADOCK_SHERPA_VERSION! for Windows packaging...
  call "%CHARADOCK_NPM%" pack --silent --pack-destination "%TEMP%" "sherpa-onnx-win-x64@!CHARADOCK_SHERPA_VERSION!"
  if errorlevel 1 (
    popd
    exit /b 1
  )
  if not exist "!CHARADOCK_SHERPA_ARCHIVE!" (
    echo The sherpa-onnx Windows package archive was not created. 1>&2
    popd
    exit /b 1
  )
  mkdir "node_modules\sherpa-onnx-win-x64" >nul 2>&1
  tar.exe -xzf "!CHARADOCK_SHERPA_ARCHIVE!" -C "node_modules\sherpa-onnx-win-x64" --strip-components=1
  set "CHARADOCK_SHERPA_EXTRACT_EXIT=!ERRORLEVEL!"
  del /q "!CHARADOCK_SHERPA_ARCHIVE!" >nul 2>&1
  if not "!CHARADOCK_SHERPA_EXTRACT_EXIT!" == "0" (
    echo Could not extract the sherpa-onnx Windows native addon. 1>&2
    popd
    exit /b 1
  )
  if not exist "node_modules\sherpa-onnx-win-x64\sherpa-onnx.node" (
    echo The sherpa-onnx Windows native addon is missing after extraction. 1>&2
    popd
    exit /b 1
  )
)

if not "%~1"=="" if /I not "%~1"=="store" (
  echo Unknown Windows package kind: %~1. Expected no argument or store. 1>&2
  popd
  exit /b 1
)

if /I not "%~1"=="store" (
  "%CHARADOCK_NODE%" node_modules\electron-builder\out\cli\cli.js --win nsis portable
  set "CHARADOCK_BUILD_EXIT=!ERRORLEVEL!"
  popd
  exit /b !CHARADOCK_BUILD_EXIT!
)

if not defined CHARADOCK_NPX (
  echo Windows npx.cmd is required to run Microsoft WinApp CLI. 1>&2
  popd
  exit /b 1
)
if not exist "packaging\windows-store\AppxManifest.xml" (
  echo The Microsoft Store AppxManifest.xml is missing. 1>&2
  popd
  exit /b 1
)

"%CHARADOCK_NODE%" node_modules\electron-builder\out\cli\cli.js --win --dir --x64 --publish never
if errorlevel 1 (
  popd
  exit /b 1
)

set "CHARADOCK_VERSION_FILE=%TEMP%\charadock-version-%RANDOM%-%RANDOM%.txt"
"%CHARADOCK_NODE%" -p "require('./package.json').version" > "!CHARADOCK_VERSION_FILE!"
set /p CHARADOCK_VERSION=<"!CHARADOCK_VERSION_FILE!"
del /q "!CHARADOCK_VERSION_FILE!" >nul 2>&1
if not defined CHARADOCK_VERSION (
  echo Could not resolve the CharaDock package version. 1>&2
  popd
  exit /b 1
)

set "CHARADOCK_STORE_TEMP=%TEMP%\charadock-store-%RANDOM%-%RANDOM%"
set "CHARADOCK_STORE_LAYOUT=!CHARADOCK_STORE_TEMP!\layout"
set "CHARADOCK_STORE_PACKAGE=!CHARADOCK_STORE_TEMP!\CharaDock-!CHARADOCK_VERSION!-store-x64-unsigned.msix"
mkdir "!CHARADOCK_STORE_LAYOUT!" >nul 2>&1
robocopy "dist\win-unpacked" "!CHARADOCK_STORE_LAYOUT!" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo Could not stage the Windows application for Store packaging. 1>&2
  rmdir /s /q "!CHARADOCK_STORE_TEMP!" >nul 2>&1
  popd
  exit /b 1
)
copy /Y "packaging\windows-store\AppxManifest.xml" "!CHARADOCK_STORE_LAYOUT!\AppxManifest.xml" >nul
xcopy /E /I /Y "packaging\windows-store\Assets" "!CHARADOCK_STORE_LAYOUT!\Assets" >nul

call "%CHARADOCK_NPX%" -y @microsoft/winappcli@0.6.0 package "!CHARADOCK_STORE_LAYOUT!" --manifest "!CHARADOCK_STORE_LAYOUT!\AppxManifest.xml" --output "!CHARADOCK_STORE_PACKAGE!"
set "CHARADOCK_BUILD_EXIT=!ERRORLEVEL!"
if "!CHARADOCK_BUILD_EXIT!"=="0" (
  if not exist "dist\store" mkdir "dist\store"
  move /Y "!CHARADOCK_STORE_PACKAGE!" "dist\store\CharaDock-!CHARADOCK_VERSION!-store-x64-unsigned.msix" >nul
)
rmdir /s /q "!CHARADOCK_STORE_TEMP!" >nul 2>&1
popd
exit /b !CHARADOCK_BUILD_EXIT!
