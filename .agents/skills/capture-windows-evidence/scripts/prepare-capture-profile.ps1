param(
  [Parameter(Mandatory = $true)]
  [string]$SourceProfile,
  [Parameter(Mandatory = $true)]
  [string]$DestinationProfile,
  [string]$CharacterId = "amber-avatar",
  [string]$WorkDirectory = "",
  [switch]$LinkModelData,
  [switch]$IncludeSelectedBeatrice,
  [switch]$IncludeSelectedSbv2,
  [switch]$Overwrite
)

$ErrorActionPreference = "Stop"
$source = [IO.Path]::GetFullPath($SourceProfile)
$destination = [IO.Path]::GetFullPath($DestinationProfile)
if ($source.TrimEnd('\') -eq $destination.TrimEnd('\')) { throw "Source and destination profiles must differ." }
$sourcePreferences = Join-Path $source "preferences.json"
if (!(Test-Path -LiteralPath $sourcePreferences -PathType Leaf)) { throw "Source preferences.json was not found." }

if (Test-Path -LiteralPath $destination) {
  if (!$Overwrite) { throw "Destination exists; pass -Overwrite to replace the capture profile." }
  Remove-Item -LiteralPath $destination -Recurse -Force
}
[IO.Directory]::CreateDirectory($destination) | Out-Null

$original = Get-Content -LiteralPath $sourcePreferences -Raw -Encoding UTF8 | ConvertFrom-Json
$safe = [ordered]@{}
$allowList = @(
  "language", "backend", "codexChatModel", "codexChatReasoningEffort", "codexWorkModel", "codexWorkReasoningEffort",
  "alwaysOnTop", "mascotPointerMode", "mouseFollow", "positionLocked", "edgeSnap", "interactionMode",
  "ttsEnabled", "ttsProvider", "styleBertVits2Url", "styleBertVits2ModelId", "styleBertVits2Speed",
  "supertonicVoice", "supertonicSpeed", "supertonicSteps", "irodoriVoiceId", "irodoriSpeed", "irodoriSteps",
  "irodoriSamplingMode", "irodoriSeed", "irodoriVersion", "irodoriMode", "irodoriCaption", "irodoriAutoEmotion",
  "irodoriEmotionStrength", "irodoriCfgExecution", "kokoroVoice", "kokoroSpeed", "kokoroDevice",
  "realtimeVoice", "englishPronunciationEnabled", "speechInputProvider", "realtimeAutoStartOnText"
)
foreach ($key in $allowList) {
  if ($null -ne $original.PSObject.Properties[$key]) { $safe[$key] = $original.$key }
}

$safe["characterId"] = $CharacterId
$safe["characterProfiles"] = @{}
$safe["characterTtsProfiles"] = @{}
if ($null -ne $original.characterTtsProfiles -and $null -ne $original.characterTtsProfiles.PSObject.Properties[$CharacterId]) {
  $safe["characterTtsProfiles"][$CharacterId] = $original.characterTtsProfiles.$CharacterId
}
$safe["onboardingComplete"] = $true
$safe["launchAtLogin"] = $false
$safe["updateChecksEnabled"] = $false
$safe["workDirectory"] = $(if ($WorkDirectory) { [IO.Path]::GetFullPath($WorkDirectory) } else { "" })
$safe["customCharacters"] = @()
$safe["conversationHistories"] = @{}
$safe["characterMemories"] = @{}
$safe["characterWorkspaces"] = @{}
$safe["webPreviewRuntimes"] = @{}
$safe["workHistory"] = @()
$safe["sbv2Models"] = @()
$safe["beatriceModels"] = @()
$safe["irodoriVoices"] = @()
$safe["irodoriModelDirectory"] = ""
$safe["irodoriV4ModelDirectory"] = ""
$safe["irodoriReferenceAudioPath"] = ""
$safe["supertonicModelDirectory"] = ""
$safe["kokoroModelDirectory"] = ""
$safe["piperPlusExecutablePath"] = ""
$safe["piperPlusModelPath"] = ""
$safe["beatriceVstPath"] = ""
$safe["beatriceModelPath"] = ""

# Explicit opt-in: retain only the selected voice's local model reference.
# No model weights, credentials or unrelated voice models are copied.
if ($IncludeSelectedBeatrice) {
  $voice = $safe["characterTtsProfiles"][$CharacterId]
  if (!$voice -or $voice.realtimeVoiceConversion -ne "beatrice-v2") { throw "Selected character has no Beatrice voice." }
  $model = @($original.beatriceModels | Where-Object { $_.id -eq $voice.beatriceModelId })
  if ($model.Count -ne 1 -or !(Test-Path -LiteralPath $model[0].modelPath -PathType Leaf)) { throw "Selected Beatrice model is unavailable." }
  if (!(Test-Path -LiteralPath $original.beatriceVstPath)) { throw "Beatrice VST is unavailable." }
  $safe["beatriceModels"] = @($model[0])
  $safe["beatriceVstPath"] = $original.beatriceVstPath
}

if ($IncludeSelectedSbv2) {
  $voice = $safe["characterTtsProfiles"][$CharacterId]
  if (!$voice -or $voice.provider -ne "sbv2-jp-extra") { throw "Selected character has no SBV2 voice." }
  $model = @($original.sbv2Models | Where-Object { $_.id -eq $voice.sbv2ModelId })
  if ($model.Count -ne 1 -or $model[0].id -notmatch '^sbv2-[a-z0-9-]+$') { throw "Selected SBV2 model is unavailable." }
  $modelRoot = Join-Path $source ("sbv2-models\" + $model[0].id)
  if (!(Test-Path -LiteralPath (Join-Path $modelRoot "model.aivmx") -PathType Leaf)) { throw "SBV2 weights are unavailable." }
  $safe["sbv2Models"] = @($model[0])
  $safe["ttsEnabled"] = $true
  $safe["realtimeAutoStartOnText"] = $false
  $safe["speechInputProvider"] = "streaming-local"
  $targetRoot = Join-Path $destination "sbv2-models"
  [IO.Directory]::CreateDirectory($targetRoot) | Out-Null
  New-Item -ItemType Junction -Path (Join-Path $targetRoot $model[0].id) -Target $modelRoot | Out-Null
}

$destinationPreferences = Join-Path $destination "preferences.json"
[IO.File]::WriteAllText($destinationPreferences, ($safe | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))

$linked = @()
if ($LinkModelData) {
  foreach ($directoryName in @("tts-models", "sherpa-onnx-models")) {
    $sourceDirectory = Join-Path $source $directoryName
    if (!(Test-Path -LiteralPath $sourceDirectory -PathType Container)) { continue }
    $destinationDirectory = Join-Path $destination $directoryName
    New-Item -ItemType Junction -Path $destinationDirectory -Target $sourceDirectory | Out-Null
    $linked += $directoryName
  }
}

[PSCustomObject]@{
  destination = $destination
  characterId = $CharacterId
  workDirectory = $safe["workDirectory"]
  linkedModelDirectories = $linked
  excluded = @("encryptedApiKey", "conversationHistories", "characterMemories", "workHistory", "characterWorkspaces", "customCharacters", "browser/session storage", "logs and caches")
} | ConvertTo-Json -Depth 4
