# SPDX-License-Identifier: Apache-2.0
# Fixed WinRT bridge. Requests arrive as JSON on stdin, never as executable text.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$awaitMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await-Result($operation, [Type]$type) {
  $task = $awaitMethod.MakeGenericMethod($type).Invoke($null, @($operation))
  if (!$task.Wait(3000)) { throw 'media-timeout' }
  return $task.Result
}
function Own-Player([string]$id) { return $id -match '(?i)(charadock|purupuru|(^|[\\/])electron(?:\.exe)?$)' }
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.action -notin @('list','pause','play','next','previous')) { throw 'invalid-action' }
  $manager = Await-Result ($managerType::RequestAsync()) $managerType
  $sessions = @($manager.GetSessions() | Where-Object { !(Own-Player $_.SourceAppUserModelId) })
  if ($request.action -eq 'list') {
    $items = @()
    foreach ($s in $sessions) {
      try {
        $info = $s.GetPlaybackInfo()
        $title = ''; $artist = ''
        try { $m = Await-Result ($s.TryGetMediaPropertiesAsync()) $propertiesType; $title = $m.Title; $artist = $m.Artist } catch {}
        $items += @{sourceAppId=$s.SourceAppUserModelId; title=$title; artist=$artist; status=$info.PlaybackStatus.ToString(); controls=@{pause=$info.Controls.IsPauseEnabled; play=$info.Controls.IsPlayEnabled; next=$info.Controls.IsNextEnabled; previous=$info.Controls.IsPreviousEnabled}}
      } catch {} # A session may disappear while being enumerated.
    }
    @{ok=$true; sessions=@($items)} | ConvertTo-Json -Depth 5 -Compress
  } else {
    $matches = @($sessions | Where-Object { $_.SourceAppUserModelId -ceq $request.sourceAppId })
    if ($matches.Count -ne 1) { throw 'session-changed' }
    $s = $matches[0]; $info = $s.GetPlaybackInfo()
    # Revalidate the selected content: a browser can reuse its app id for another tab.
    $media = Await-Result ($s.TryGetMediaPropertiesAsync()) $propertiesType
    if ($media.Title -cne $request.expectedTitle -or $media.Artist -cne $request.expectedArtist) { throw 'session-changed' }
    if (($request.action -eq 'pause' -and $info.PlaybackStatus.ToString() -eq 'Paused') -or
        ($request.action -eq 'play' -and $info.PlaybackStatus.ToString() -eq 'Playing')) {
      @{ok=$true; accepted=$true; unchanged=$true; status=$info.PlaybackStatus.ToString()} | ConvertTo-Json -Compress
    } else {
      $operation = switch ($request.action) {
        'pause' { if (!$info.Controls.IsPauseEnabled) { throw 'unsupported-action' }; $s.TryPauseAsync() }
        'play' { if (!$info.Controls.IsPlayEnabled) { throw 'unsupported-action' }; $s.TryPlayAsync() }
        'next' { if (!$info.Controls.IsNextEnabled) { throw 'unsupported-action' }; $s.TrySkipNextAsync() }
        'previous' { if (!$info.Controls.IsPreviousEnabled) { throw 'unsupported-action' }; $s.TrySkipPreviousAsync() }
      }
      $accepted = Await-Result $operation ([bool])
      @{ok=$true; accepted=[bool]$accepted; status=$s.GetPlaybackInfo().PlaybackStatus.ToString()} | ConvertTo-Json -Compress
    }
  }
} catch {
  $reason = $_.Exception.Message
  if ($reason -notin @('invalid-action','session-changed','unsupported-action','media-timeout')) { $reason='media-unavailable' }
  @{ok=$false; reason=$reason} | ConvertTo-Json -Compress
}
