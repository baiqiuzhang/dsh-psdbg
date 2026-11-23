$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinDialog {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  public const uint WM_COMMAND = 0x0111;
  public const uint WM_CLOSE = 0x0010;
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  public const int IDOK = 1;
  public const int VK_RETURN = 0x0D;
}
'@
Add-Type -TypeDefinition $src

$hwnd = [WinDialog]::FindWindow('PSDialogBox', 'Adobe Photoshop')
Write-Output ("HWND=" + $hwnd + " visible=" + [WinDialog]::IsWindowVisible($hwnd))
if ($hwnd -eq [IntPtr]::Zero) { exit 2 }

[WinDialog]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 200
$r1 = [WinDialog]::PostMessage($hwnd, [WinDialog]::WM_COMMAND, [IntPtr][WinDialog]::IDOK, [IntPtr]::Zero)
$r2 = [WinDialog]::PostMessage($hwnd, [WinDialog]::WM_KEYDOWN, [IntPtr][WinDialog]::VK_RETURN, [IntPtr]::Zero)
$r3 = [WinDialog]::PostMessage($hwnd, [WinDialog]::WM_KEYUP, [IntPtr][WinDialog]::VK_RETURN, [IntPtr]::Zero)
Write-Output ("POSTED command=" + $r1 + " keydown=" + $r2 + " keyup=" + $r3)
Start-Sleep -Milliseconds 800
$still = [WinDialog]::FindWindow('PSDialogBox', 'Adobe Photoshop')
Write-Output ("AFTER=" + $still)
if ($still -ne [IntPtr]::Zero) {
  $r4 = [WinDialog]::PostMessage($still, [WinDialog]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
  Write-Output ("CLOSE posted=" + $r4)
}
