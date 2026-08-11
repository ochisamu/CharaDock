@echo off
rem SPDX-License-Identifier: Apache-2.0
setlocal

set "CHARADOCK_DEV_ROOT=%~dp0.."
pushd "%CHARADOCK_DEV_ROOT%" || exit /b 1

set "CHARADOCK_NODE=C:\Program Files\nodejs\node.exe"
if not exist "%CHARADOCK_NODE%" (
  set "CHARADOCK_NODE="
  for /f "delims=" %%N in ('where node 2^>nul') do if not defined CHARADOCK_NODE set "CHARADOCK_NODE=%%N"
)
if not defined CHARADOCK_NODE (
  echo Windows node.exe was not found. Install Node.js 22 or later. 1>&2
  popd
  exit /b 1
)

if /i "%~1"=="--prepare" goto prepare
if not exist "node_modules\electron\cli.js" (
  echo Windows Electron dependencies are missing. Run npm run desktop:win:dev again. 1>&2
  popd
  exit /b 1
)

set "CHARADOCK_SHARED_PROFILE=0"
set "CHARADOCK_SMOKE_TEST=0"
set "CHARADOCK_SMOKE_WORK_SLM="
:parse
if "%~1"=="" goto run
if /i "%~1"=="--shared-profile" set "CHARADOCK_SHARED_PROFILE=1"
if /i "%~1"=="--smoke-test" set "CHARADOCK_SMOKE_TEST=1"
if /i "%~1"=="--smoke-work-slm" set "CHARADOCK_SMOKE_WORK_SLM=all"
if /i "%~1"=="--smoke-work-slm-qwen35" set "CHARADOCK_SMOKE_WORK_SLM=qwen35"
if /i "%~1"=="--smoke-work-slm-lfm" set "CHARADOCK_SMOKE_WORK_SLM=lfm"
if /i "%~1"=="--smoke-work-slm-qwen25" set "CHARADOCK_SMOKE_WORK_SLM=qwen25"
shift
goto parse

:run
set "CHARADOCK_EXTRA_ARGS="
if "%CHARADOCK_SMOKE_TEST%"=="1" set "CHARADOCK_EXTRA_ARGS=--smoke-test"
if /i "%CHARADOCK_SMOKE_WORK_SLM%"=="all" set "CHARADOCK_EXTRA_ARGS=%CHARADOCK_EXTRA_ARGS% --smoke-work-slm"
if /i "%CHARADOCK_SMOKE_WORK_SLM%"=="qwen35" set "CHARADOCK_EXTRA_ARGS=%CHARADOCK_EXTRA_ARGS% --smoke-work-slm-qwen35"
if /i "%CHARADOCK_SMOKE_WORK_SLM%"=="lfm" set "CHARADOCK_EXTRA_ARGS=%CHARADOCK_EXTRA_ARGS% --smoke-work-slm-lfm"
if /i "%CHARADOCK_SMOKE_WORK_SLM%"=="qwen25" set "CHARADOCK_EXTRA_ARGS=%CHARADOCK_EXTRA_ARGS% --smoke-work-slm-qwen25"
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
set "CHARADOCK_NPM=C:\Program Files\nodejs\npm.cmd"
if not exist "%CHARADOCK_NPM%" (
  set "CHARADOCK_NPM="
  for /f "delims=" %%N in ('where npm.cmd 2^>nul') do if not defined CHARADOCK_NPM set "CHARADOCK_NPM=%%N"
)
if not defined CHARADOCK_NPM (
  echo Windows npm.cmd was not found. Install Node.js 22 or later. 1>&2
  popd
  exit /b 1
)
call "%CHARADOCK_NPM%" ci --no-audit --no-fund
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
