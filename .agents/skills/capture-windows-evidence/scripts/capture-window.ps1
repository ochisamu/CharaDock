param(
  [ValidateSet("Screenshot", "Record")]
  [string]$Mode = "Screenshot",
  [ValidateSet("Window", "Desktop")]
  [string]$CaptureArea = "Window",
  [string]$WindowTitle = "",
  [string]$ExcludeWindowTitle = "",
  [string]$ProcessName = "CharaDock",
  [switch]$ExactWindowTitle,
  [switch]$DoNotActivate,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [ValidateRange(1, 3600)]
  [int]$DurationSeconds = 10,
  [ValidateRange(1, 60)]
  [int]$FrameRate = 30,
  [ValidateRange(0, 30)]
  [int]$WaitSeconds = 1,
  [string]$AudioDevice = "",
  [switch]$IncludeCursor
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class CharaDockWindowCapture {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")]
  public static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT rect, int size);

  public static bool Activate(IntPtr hWnd) {
    uint targetProcess;
    uint targetThread = GetWindowThreadProcessId(hWnd, out targetProcess);
    uint foregroundProcess;
    uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out foregroundProcess);
    uint currentThread = GetCurrentThreadId();
    if (currentThread != targetThread) AttachThreadInput(currentThread, targetThread, true);
    if (foregroundThread != 0 && foregroundThread != currentThread) AttachThreadInput(currentThread, foregroundThread, true);
    ShowWindow(hWnd, 9);
    BringWindowToTop(hWnd);
    bool activated = SetForegroundWindow(hWnd);
    SetFocus(hWnd);
    if (foregroundThread != 0 && foregroundThread != currentThread) AttachThreadInput(currentThread, foregroundThread, false);
    if (currentThread != targetThread) AttachThreadInput(currentThread, targetThread, false);
    return activated;
  }

  public static bool IsTopmost(IntPtr hWnd) { return (GetWindowLong(hWnd, -20) & 0x00000008) != 0; }
  public static bool SetTopmost(IntPtr hWnd, bool topmost) {
    return SetWindowPos(hWnd, topmost ? new IntPtr(-1) : new IntPtr(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0040);
  }

  public static Tuple<IntPtr, RECT, string> FindLargest(string titlePart, string excludedTitlePart, string processName, bool exactTitle) {
    var matches = new List<Tuple<IntPtr, RECT, string>>();
    EnumWindows((hWnd, _) => {
      if (!IsWindowVisible(hWnd)) return true;
      var text = new StringBuilder(1024);
      GetWindowText(hWnd, text, text.Capacity);
      var title = text.ToString();
      if (exactTitle ? !String.Equals(title, titlePart, StringComparison.OrdinalIgnoreCase) : title.IndexOf(titlePart, StringComparison.OrdinalIgnoreCase) < 0) return true;
      if (!String.IsNullOrWhiteSpace(excludedTitlePart) && title.IndexOf(excludedTitlePart, StringComparison.OrdinalIgnoreCase) >= 0) return true;
      if (!String.IsNullOrWhiteSpace(processName)) {
        uint processId;
        GetWindowThreadProcessId(hWnd, out processId);
        try {
          if (!String.Equals(Process.GetProcessById((int)processId).ProcessName, processName, StringComparison.OrdinalIgnoreCase)) return true;
        } catch { return true; }
      }
      RECT rect;
      if (DwmGetWindowAttribute(hWnd, 9, out rect, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(hWnd, out rect);
      if (rect.Right > rect.Left && rect.Bottom > rect.Top) matches.Add(Tuple.Create(hWnd, rect, title));
      return true;
    }, IntPtr.Zero);
    matches.Sort((a, b) => ((b.Item2.Right - b.Item2.Left) * (b.Item2.Bottom - b.Item2.Top)).CompareTo((a.Item2.Right - a.Item2.Left) * (a.Item2.Bottom - a.Item2.Top)));
    return matches.Count > 0 ? matches[0] : null;
  }
}
"@

if ($WaitSeconds -gt 0) { Start-Sleep -Seconds $WaitSeconds }
$targetTitle = "Windows desktop"
$captureHandle = [IntPtr]::Zero
$restoreNotTopmost = $false
if ($CaptureArea -eq "Desktop") {
  Add-Type -AssemblyName System.Windows.Forms
  $virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $rect = New-Object CharaDockWindowCapture+RECT
  $rect.Left = $virtual.Left
  $rect.Top = $virtual.Top
  $rect.Right = $virtual.Right
  $rect.Bottom = $virtual.Bottom
} else {
  $target = $null
  for ($attempt = 0; $attempt -lt 100 -and $null -eq $target; $attempt += 1) {
    $target = [CharaDockWindowCapture]::FindLargest($WindowTitle, $ExcludeWindowTitle, $ProcessName, [bool]$ExactWindowTitle)
    if ($null -eq $target) { Start-Sleep -Milliseconds 100 }
  }
  if ($null -eq $target) { throw "No visible window matches process '$ProcessName', title '$WindowTitle', and exclusion '$ExcludeWindowTitle'." }
  $rect = $target.Item2
  $targetTitle = $target.Item3
  $captureHandle = $target.Item1
  if (!$DoNotActivate) {
    if (![CharaDockWindowCapture]::Activate($target.Item1)) { throw "Could not activate the selected window." }
    $restoreNotTopmost = ![CharaDockWindowCapture]::IsTopmost($target.Item1)
    [CharaDockWindowCapture]::SetTopmost($target.Item1, $true) | Out-Null
    Start-Sleep -Milliseconds 500
    $target = [CharaDockWindowCapture]::FindLargest($WindowTitle, $ExcludeWindowTitle, $ProcessName, [bool]$ExactWindowTitle)
    if ($null -ne $target) { $rect = $target.Item2 }
  }
}
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($Mode -eq "Record") {
  $width -= $width % 2
  $height -= $height % 2
}
if ($width -lt 64 -or $height -lt 64) { throw "Capture rectangle is too small: ${width}x${height}." }

$ffmpeg = (Get-Command ffmpeg.exe -ErrorAction Stop).Path
$fullOutput = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = [IO.Path]::GetDirectoryName($fullOutput)
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

$arguments = @(
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "gdigrab", "-framerate", "$FrameRate",
  "-draw_mouse", $(if ($IncludeCursor) { "1" } else { "0" }),
  "-offset_x", "$($rect.Left)", "-offset_y", "$($rect.Top)",
  "-video_size", "${width}x${height}", "-i", "desktop"
)
if ($Mode -eq "Record" -and $AudioDevice) {
  $arguments += @("-thread_queue_size", "512", "-f", "dshow", "-i", "audio=$AudioDevice")
}
if ($Mode -eq "Screenshot") {
  $arguments += @("-frames:v", "1", $fullOutput)
} else {
  $arguments += @("-t", "$DurationSeconds", "-map", "0:v:0")
  if ($AudioDevice) { $arguments += @("-map", "1:a:0", "-c:a", "aac", "-b:a", "192k") }
  else { $arguments += "-an" }
  $arguments += @("-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", $fullOutput)
}

function Quote-NativeArgument([string]$value) {
  if ($value -notmatch '[\s"]') { return $value }
  return '"' + $value.Replace('"', '\"') + '"'
}
$argumentLine = ($arguments | ForEach-Object { Quote-NativeArgument ([string]$_) }) -join " "
try {
  $nativeProcess = Start-Process -FilePath $ffmpeg -ArgumentList $argumentLine -Wait -PassThru -NoNewWindow
  if ($nativeProcess.ExitCode -ne 0) {
    throw "ffmpeg failed with exit code $($nativeProcess.ExitCode)."
  }
} finally {
  if ($restoreNotTopmost -and $captureHandle -ne [IntPtr]::Zero) {
    [CharaDockWindowCapture]::SetTopmost($captureHandle, $false) | Out-Null
  }
}
if (!(Test-Path -LiteralPath $fullOutput) -or (Get-Item -LiteralPath $fullOutput).Length -le 0) { throw "Capture output was not created." }

[PSCustomObject]@{
  mode = $Mode
  title = $targetTitle
  processName = $(if ($CaptureArea -eq "Window") { $ProcessName } else { $null })
  output = $fullOutput
  width = $width
  height = $height
  fps = $(if ($Mode -eq "Record") { $FrameRate } else { $null })
  durationSeconds = $(if ($Mode -eq "Record") { $DurationSeconds } else { $null })
  audioDevice = $(if ($Mode -eq "Record" -and $AudioDevice) { $AudioDevice } else { $null })
} | ConvertTo-Json -Compress
