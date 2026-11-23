$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinEnum {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  public static List<string> Rows = new List<string>();
  public static uint Target = 6468;
  public static bool Top(IntPtr h, IntPtr l) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (pid == Target) Row(h, 0);
    return true;
  }
  public static bool Child(IntPtr h, IntPtr l) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (pid == Target) Row(h, 1);
    return true;
  }
  public static void Row(IntPtr h, int level) {
    var t = new StringBuilder(512); GetWindowText(h, t, 512);
    var c = new StringBuilder(256); GetClassName(h, c, 256);
    Rows.Add(level + "|" + h.ToInt64() + "|" + IsWindowVisible(h) + "|" + c + "|" + t);
  }
}
'@
Add-Type -TypeDefinition $src
[WinEnum]::EnumWindows([WinEnum+EnumProc]{ param($h,$l) [WinEnum]::Top($h,$l) }, [IntPtr]::Zero) | Out-Null
[WinEnum]::EnumWindows([WinEnum+EnumProc]{ param($h,$l) [WinEnum]::Child($h,$l) }, [IntPtr]::Zero) | Out-Null
[WinEnum]::Rows | ForEach-Object { Write-Output $_ }
