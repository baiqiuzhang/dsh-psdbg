Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.Condition]::TrueCondition
)
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
$script:count = 0

foreach ($top in $tops) {
  $procId = $top.Current.ProcessId
  if ($procId -ne 6468) { continue }
  Write-Output ("TOP type=" + $top.Current.ControlType.ProgrammaticName + " name=" + $top.Current.Name + " auto=" + $top.Current.AutomationId)
  $stack = New-Object System.Collections.Stack
  $stack.Push(@($top, 0))
  while ($stack.Count -gt 0) {
    $item = $stack.Pop()
    $el = $item[0]; $d = $item[1]
    if ($null -eq $el -or $d -gt 8 -or $script:count -gt 2000) { continue }
    $script:count++
    $name = $el.Current.Name
    $auto = $el.Current.AutomationId
    $type = $el.Current.ControlType.ProgrammaticName
    if ($name -ne '' -or $auto -ne '') {
      Write-Output ("{0}{1} | {2} | auto={3}" -f ('  ' * $d), $type, $name, $auto)
    }
    $child = $walker.GetFirstChild($el)
    while ($null -ne $child) {
      $stack.Push(@($child, $d + 1))
      $child = $walker.GetNextSibling($child)
    }
  }
}
Write-Output ("VISITED=" + $script:count)
