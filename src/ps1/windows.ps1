param(
  [string]$TitleMatch = '',
  [switch]$All
)

$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class PsWindows {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static uint TargetPid;
  public static List<object> Rows = new List<object>();
  public static bool Callback(IntPtr h, IntPtr l) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (pid != TargetPid) return true;
    var cls = new StringBuilder(256); GetClassName(h, cls, 256);
    var title = new StringBuilder(512); GetWindowText(h, title, 512);
    RECT r; GetWindowRect(h, out r);
    int w = r.Right - r.Left, hh = r.Bottom - r.Top;
    Rows.Add(new { handle = h.ToInt64(), title = title.ToString(), className = cls.ToString(), visible = IsWindowVisible(h), x = r.Left, y = r.Top, width = w, height = hh });
    return true;
  }
}
'@
Add-Type -TypeDefinition $src

$proc = Get-Process Photoshop -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $proc) {
  [pscustomobject]@{ ok = $false; error = 'Photoshop is not running'; windows = @() } | ConvertTo-Json -Depth 5 -Compress
  exit 1
}
[PsWindows]::TargetPid = [uint32]$proc.Id
[PsWindows]::EnumWindows([PsWindows+EnumProc]{ param($h,$l) [PsWindows]::Callback($h,$l) }, [IntPtr]::Zero) | Out-Null

$rows = @([PsWindows]::Rows)
if (-not $All) {
  $rows = @($rows | Where-Object {
    $_.visible -and (
      ($_.className -eq 'OWL.Dock' -and $_.width -ge 150 -and $_.height -ge 150 -and $_.width -le 1200 -and $_.height -le 1200) -or
      ($TitleMatch -ne '' -and $_.title -like "*$TitleMatch*")
    )
  })
}
[pscustomobject]@{ ok = $true; processId = $proc.Id; windows = $rows } | ConvertTo-Json -Depth 6 -Compress
