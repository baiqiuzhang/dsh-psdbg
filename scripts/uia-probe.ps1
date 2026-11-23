Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$proc = Get-Process Photoshop -ErrorAction Stop | Select-Object -First 1
Write-Output ("PID=" + $proc.Id + " TITLE=" + $proc.MainWindowTitle)
$root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$script:count = 0

function Walk($el, $depth) {
  if ($null -eq $el -or $depth -gt 6 -or $script:count -gt 800) { return }
  $script:count++
  $name = $el.Current.Name
  $type = $el.Current.ControlType.ProgrammaticName
  $auto = $el.Current.AutomationId
  Write-Output ("{0}{1} | {2} | auto={3} | offscreen={4}" -f ('  ' * $depth), $type, $name, $auto, $el.Current.IsOffscreen)
  $child = $walker.GetFirstChild($el)
  while ($null -ne $child) {
    Walk $child ($depth + 1)
    $child = $walker.GetNextSibling($child)
  }
}

Walk $root 0
Write-Output ("VISITED=" + $script:count)
