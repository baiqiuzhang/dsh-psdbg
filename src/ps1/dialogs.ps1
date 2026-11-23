param(
  [switch]$List,
  [long]$Handle = 0,
  [switch]$All
)

$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class PsDialogs {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  public const uint WM_CLOSE = 0x0010;
  public static uint TargetPid;
  public static List<object> Rows = new List<object>();
  public static bool Callback(IntPtr h, IntPtr l) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (pid != TargetPid) return true;
    var cls = new StringBuilder(256); GetClassName(h, cls, 256);
    if (cls.ToString() != "PSDialogBox") return true;
    var title = new StringBuilder(512); GetWindowText(h, title, 512);
    Rows.Add(new { handle = h.ToInt64(), title = title.ToString(), className = cls.ToString(), visible = IsWindowVisible(h) });
    return true;
  }
}
'@
Add-Type -TypeDefinition $src

$proc = Get-Process Photoshop -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $proc) {
  [pscustomobject]@{ ok = $false; error = 'Photoshop is not running'; dialogs = @() } | ConvertTo-Json -Depth 5 -Compress
  exit 1
}
[PsDialogs]::TargetPid = [uint32]$proc.Id
[PsDialogs]::EnumWindows([PsDialogs+EnumProc]{ param($h,$l) [PsDialogs]::Callback($h,$l) }, [IntPtr]::Zero) | Out-Null

if ($List -or (-not $All -and $Handle -eq 0)) {
  [pscustomobject]@{ ok = $true; processId = $proc.Id; dialogs = @([PsDialogs]::Rows) } | ConvertTo-Json -Depth 5 -Compress
  exit 0
}

$targets = @()
if ($Handle -ne 0) { $targets = @([IntPtr]$Handle) }
elseif ($All) {
  foreach ($row in [PsDialogs]::Rows) {
    if ($row.visible) { $targets += [IntPtr]$row.handle }
  }
}
$dismissed = @()
foreach ($h in $targets) {
  if ([PsDialogs]::PostMessage($h, [PsDialogs]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)) {
    $dismissed += $h.ToInt64()
  }
}
[pscustomobject]@{ ok = $true; processId = $proc.Id; dismissed = $dismissed } | ConvertTo-Json -Depth 5 -Compress
