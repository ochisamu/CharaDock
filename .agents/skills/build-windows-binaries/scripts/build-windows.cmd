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

"%CHARADOCK_NODE%" node_modules\electron-builder\out\cli\cli.js --win nsis portable
set "CHARADOCK_BUILD_EXIT=%ERRORLEVEL%"
popd
exit /b %CHARADOCK_BUILD_EXIT%
