Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

$procId = 6468
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
  $procId
)
$all = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  $cond
)
$target = $null
foreach ($el in $all) {
  $name = $el.Current.Name
  if ($el.Current.AutomationId -eq '10' -or $name -eq 'OK') {
    Write-Output ("FOUND name=" + $name + " type=" + $el.Current.ControlType.ProgrammaticName + " auto=" + $el.Current.AutomationId)
    $target = $el
    break
  }
}
if ($null -eq $target) {
  Write-Output 'NO TARGET'
  exit 2
}

$done = $false
try {
  $p = $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $p.Invoke()
  $done = $true
  Write-Output 'INVOKED'
} catch {
  Write-Output ("Invoke failed: " + $_.Exception.Message)
}
if (-not $done) {
  try {
    $p = $target.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
    $p.DoDefaultAction()
    $done = $true
    Write-Output 'LEGACY'
  } catch {
    Write-Output ("Legacy failed: " + $_.Exception.Message)
  }
}
if (-not $done) {
  try {
    $target.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    $done = $true
    Write-Output 'SENDKEYS'
  } catch {
    Write-Output ("SendKeys failed: " + $_.Exception.Message)
  }
}
Start-Sleep -Milliseconds 500
Write-Output ("DONE=" + $done)
