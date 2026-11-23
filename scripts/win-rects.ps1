$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinRects {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static uint TargetPid;
  public static List<string> Rows = new List<string>();
  public static bool Callback(IntPtr h, IntPtr l) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (pid != TargetPid) return true;
    var cls = new StringBuilder(256); GetClassName(h, cls, 256);
    var title = new StringBuilder(512); GetWindowText(h, title, 512);
    RECT r; GetWindowRect(h, out r);
    int w = r.Right - r.Left, hh = r.Bottom - r.Top;
    Rows.Add(h.ToInt64() + "|" + IsWindowVisible(h) + "|" + cls + "|" + title + "|" + r.Left + "," + r.Top + "," + w + "," + hh);
    return true;
  }
}
'@
Add-Type -TypeDefinition $src
$proc = Get-Process Photoshop -ErrorAction SilentlyContinue | Select-Object -First 1
[WinRects]::TargetPid = [uint32]$proc.Id
[WinRects]::EnumWindows([WinRects+EnumProc]{ param($h,$l) [WinRects]::Callback($h,$l) }, [IntPtr]::Zero) | Out-Null
[WinRects]::Rows | ForEach-Object { Write-Output $_ }
