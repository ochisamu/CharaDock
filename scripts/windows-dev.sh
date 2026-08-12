#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
use_shared_profile=0
smoke_test=0

for argument in "$@"; do
  case "$argument" in
    --shared-profile) use_shared_profile=1 ;;
    --smoke-test) smoke_test=1 ;;
    *) echo "Unknown option: $argument" >&2; exit 2 ;;
  esac
done

for command_name in cmd.exe wslpath rsync sha256sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required for Windows development launch from WSL." >&2
    exit 1
  fi
done

windows_local_appdata="$(cd /mnt/c && cmd.exe /d /c "echo %LOCALAPPDATA%" 2>/dev/null | tr -d '\r' | tail -n 1)"
if [[ -z "$windows_local_appdata" || "$windows_local_appdata" == *"%LOCALAPPDATA%"* ]]; then
  echo "Windows LOCALAPPDATA could not be resolved." >&2
  exit 1
fi

mirror_windows="${windows_local_appdata}\\CharaDockDev\\source"
mirror_wsl="$(wslpath -u "$mirror_windows")"
launcher_windows="${mirror_windows}\\scripts\\windows-dev.cmd"
dependency_stamp="$mirror_wsl/.charadock-dev-dependencies.sha256"

mkdir -p "$mirror_wsl"
echo "Syncing CharaDock source to $mirror_windows"
rsync -a --delete \
  --exclude '/.git/' \
  --exclude '/.venv/' \
  --exclude '/node_modules/' \
  --exclude '/dist/' \
  --exclude '/site-dist/' \
  --exclude '/work/' \
  --exclude '/tmp/' \
  --exclude '/release/' \
  --exclude '/out/' \
  --exclude '/.charadock-dev-*' \
  --exclude '*.log' \
  "$project_root/" "$mirror_wsl/"

dependency_hash="$(sha256sum "$project_root/package.json" "$project_root/package-lock.json" | sha256sum | cut -d ' ' -f 1)"
installed_hash=""
if [[ -f "$dependency_stamp" ]]; then installed_hash="$(tr -d '\r\n' < "$dependency_stamp")"; fi

if [[ ! -f "$mirror_wsl/node_modules/electron/dist/electron.exe" || "$installed_hash" != "$dependency_hash" ]]; then
  echo "Preparing Windows dependencies (first launch or package-lock change)..."
  (cd /mnt/c && cmd.exe /d /c "$launcher_windows" --prepare)
  printf '%s\n' "$dependency_hash" > "$dependency_stamp"
else
  echo "Windows dependencies are current; skipping npm ci."
fi

launcher_arguments=()
if [[ "$use_shared_profile" -eq 1 ]]; then
  echo "Starting Windows Electron with the installed CharaDock profile."
  echo "Close any installed or portable CharaDock instance first."
  launcher_arguments+=(--shared-profile)
else
  echo "Starting Windows Electron with the persistent CharaDockDev profile."
fi
if [[ "$smoke_test" -eq 1 ]]; then launcher_arguments+=(--smoke-test); fi
(cd /mnt/c && cmd.exe /d /c "$launcher_windows" "${launcher_arguments[@]}")
