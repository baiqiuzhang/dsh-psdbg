Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
  6468
)
$all = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  $cond
)
foreach ($el in $all) {
  $name = $el.Current.Name
  if ($name -match 'Depth Mask|PSDBG') {
    $r = $el.Current.BoundingRectangle
    Write-Output ("name=" + $name + " type=" + $el.Current.ControlType.ProgrammaticName + " hwnd=" + $el.Current.NativeWindowHandle + " rect=" + $r.X + "," + $r.Y + "," + $r.Width + "," + $r.Height)
  }
}
