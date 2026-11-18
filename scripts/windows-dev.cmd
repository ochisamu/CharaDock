@echo off
rem SPDX-License-Identifier: Apache-2.0
setlocal

set "CHARADOCK_DEV_ROOT=%~dp0.."
pushd "%CHARADOCK_DEV_ROOT%" || exit /b 1

set /p "CHARADOCK_DEV_NODE_VERSION=" < .node-version
set "CHARADOCK_DEV_NODE=%LOCALAPPDATA%\CharaDockDev\toolchains\node-v%CHARADOCK_DEV_NODE_VERSION%-win-x64\node.exe"
if not defined CHARADOCK_NODE if exist "%CHARADOCK_DEV_NODE%" set "CHARADOCK_NODE=%CHARADOCK_DEV_NODE%"
if not defined CHARADOCK_NODE set "CHARADOCK_NODE=C:\Program Files\nodejs\node.exe"
if not exist "%CHARADOCK_NODE%" (
  set "CHARADOCK_NODE="
  for /f "delims=" %%N in ('where node 2^>nul') do if not defined CHARADOCK_NODE set "CHARADOCK_NODE=%%N"
)
if not defined CHARADOCK_NODE (
  echo Windows node.exe was not found. Install a supported Node.js version. 1>&2
  popd
  exit /b 1
)
"%CHARADOCK_NODE%" scripts\check-runtime-security.cjs
if errorlevel 1 (
  echo Install a supported Windows Node.js version or set CHARADOCK_NODE to its node.exe. 1>&2
  popd
  exit /b 1
)
for %%N in ("%CHARADOCK_NODE%") do set "PATH=%%~dpN;%PATH%"

if /i "%~1"=="--prepare" goto prepare
if not exist "node_modules\electron\cli.js" (
  echo Windows Electron dependencies are missing. Run npm run desktop:win:dev again. 1>&2
  popd
  exit /b 1
)

set "CHARADOCK_SHARED_PROFILE=0"
set "CHARADOCK_SMOKE_TEST=0"
set "CHARADOCK_VERIFY_RLCD42_AUDIO=0"
:parse
if "%~1"=="" goto run
if /i "%~1"=="--shared-profile" set "CHARADOCK_SHARED_PROFILE=1"
if /i "%~1"=="--smoke-test" set "CHARADOCK_SMOKE_TEST=1"
if /i "%~1"=="--verify-rlcd42-audio" set "CHARADOCK_VERIFY_RLCD42_AUDIO=1"
shift
goto parse

:run
set "CHARADOCK_EXTRA_ARGS="
if "%CHARADOCK_SMOKE_TEST%"=="1" set "CHARADOCK_EXTRA_ARGS=%CHARADOCK_EXTRA_ARGS% --smoke-test"
if "%CHARADOCK_VERIFY_RLCD42_AUDIO%"=="1" set "CHARADOCK_EXTRA_ARGS=%CHARADOCK_EXTRA_ARGS% --verify-rlcd42-audio --hidden"
if "%CHARADOCK_SHARED_PROFILE%"=="1" goto run_shared
set "CHARADOCK_DEV_PROFILE=%LOCALAPPDATA%\CharaDockDev\profile"
if not exist "%CHARADOCK_DEV_PROFILE%" mkdir "%CHARADOCK_DEV_PROFILE%"
"%CHARADOCK_NODE%" node_modules\electron\cli.js . --charadock-user-data "%CHARADOCK_DEV_PROFILE%" %CHARADOCK_EXTRA_ARGS%
goto run_done

:run_shared
"%CHARADOCK_NODE%" node_modules\electron\cli.js . %CHARADOCK_EXTRA_ARGS%

:run_done
set "CHARADOCK_DEV_EXIT=%ERRORLEVEL%"
popd
exit /b %CHARADOCK_DEV_EXIT%

:prepare
for %%N in ("%CHARADOCK_NODE%") do set "CHARADOCK_NPM=%%~dpNnode_modules\npm\bin\npm-cli.js"
if not exist "%CHARADOCK_NPM%" (
  echo npm was not found next to the selected Windows node.exe. Install the full Node.js distribution. 1>&2
  popd
  exit /b 1
)
"%CHARADOCK_NODE%" "%CHARADOCK_NPM%" ci --no-audit --no-fund
set "CHARADOCK_DEV_EXIT=%ERRORLEVEL%"
if not "%CHARADOCK_DEV_EXIT%"=="0" (
  popd
  exit /b %CHARADOCK_DEV_EXIT%
)
if not exist "node_modules\electron\dist\electron.exe" "%CHARADOCK_NODE%" node_modules\electron\install.js
if not exist "node_modules\electron\dist\electron.exe" (
  echo Windows Electron binary could not be prepared. 1>&2
  popd
  exit /b 1
)
popd
exit /b %CHARADOCK_DEV_EXIT%
