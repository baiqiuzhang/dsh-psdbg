param(
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$ProcessId = 0,
    [string]$WindowTitle = '',
    [long]$WindowHandle = 0,
    [switch]$FullScreen,
    [switch]$ScreenCrop
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if (-not ('PSDebugCapture' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PSDebugCapture {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
}

[void][PSDebugCapture]::SetProcessDPIAware()

$proc = $null
if ($ProcessId -gt 0) {
    $proc = Get-Process -Id $ProcessId -ErrorAction Stop
} else {
    $procs = @(Get-Process Photoshop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    if ($WindowTitle) {
        $procs = @($procs | Where-Object { $_.MainWindowTitle -like "*$WindowTitle*" })
    }
    $proc = $procs | Select-Object -First 1
}
if (-not $proc) { throw 'Photoshop window not found' }

$hwnd = if ($WindowHandle -ne 0) { [IntPtr]$WindowHandle } else { [IntPtr]$proc.MainWindowHandle }
if ($hwnd -eq [IntPtr]::Zero) { throw 'Photoshop window handle is zero' }

$outDir = Split-Path -Parent $Out
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

$rect = New-Object PSDebugCapture+RECT
[void][PSDebugCapture]::GetWindowRect($hwnd, [ref]$rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { throw "bad window rect $w x $h" }

if ($FullScreen) {
    # Capture the whole virtual desktop, not just the primary monitor. Photoshop
    # may be on the secondary screen (this machine puts it below the primary).
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $rect.Left = $bounds.Left
    $rect.Top = $bounds.Top
    $w = $bounds.Width
    $h = $bounds.Height
}

$bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
try {
    $hdc = $gfx.GetHdc()
    try {
        [void][PSDebugCapture]::SetForegroundWindow($hwnd)
        [void][PSDebugCapture]::ShowWindow($hwnd, 9)
        Start-Sleep -Milliseconds 200
        $ok = [PSDebugCapture]::PrintWindow($hwnd, $hdc, 2)
    } finally {
        $gfx.ReleaseHdc($hdc)
    }

    if (-not $ok -or $FullScreen -or $ScreenCrop) {
        $gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)), [System.Drawing.CopyPixelOperation]::SourceCopy)
    }

    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $gfx.Dispose()
    $bmp.Dispose()
}

$result = [ordered]@{
    ok = $true
    path = (Resolve-Path -LiteralPath $Out).Path
    width = $w
    height = $h
    processId = $proc.Id
    title = $proc.MainWindowTitle
}
$result | ConvertTo-Json -Compress
