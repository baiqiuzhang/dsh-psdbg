param(
  [string]$Action = 'list',
  [long]$Handle = 0,
  [string]$Name = '',
  [string]$Value = '',
  [string]$Class = '',
  [string]$Title = '',
  [int]$ProcessId = 0,
  [int]$MaxNodes = 300
)

$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
  # Windows PowerShell 5 can refuse; the JSON is still valid, only non-ASCII labels suffer.
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Write-Json($obj, $code = 0) {
  $obj | ConvertTo-Json -Depth 8 -Compress
  exit $code
}

function Get-Root {
  if ($Handle -ne 0) {
    return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Handle)
  }
  if ($ProcessId -gt 0) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
    return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
      [System.Windows.Automation.TreeScope]::Children, $cond)
  }
  $p = Get-Process Photoshop -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $p) { Write-Json @{ ok = $false; code = 'PS_NOT_RUNNING'; message = 'Photoshop is not running' } 1 }
  return [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
}

function Get-Node($el) {
  $patterns = @()
  foreach ($pair in @(
      @('Invoke', [System.Windows.Automation.InvokePattern]::Pattern),
      @('Value', [System.Windows.Automation.ValuePattern]::Pattern),
      @('Toggle', [System.Windows.Automation.TogglePattern]::Pattern),
      @('SelectionItem', [System.Windows.Automation.SelectionItemPattern]::Pattern),
      @('ExpandCollapse', [System.Windows.Automation.ExpandCollapsePattern]::Pattern))) {
    $obj = $null
    if ($el.TryGetCurrentPattern($pair[1], [ref]$obj)) { $patterns += $pair[0] }
  }
  $r = $el.Current.BoundingRectangle
  return [pscustomobject]@{
    name = $el.Current.Name
    automationId = $el.Current.AutomationId
    className = $el.Current.ClassName
    controlType = $el.Current.ControlType.ProgrammaticName
    enabled = $el.Current.IsEnabled
    offscreen = $el.Current.IsOffscreen
    handle = $el.Current.NativeWindowHandle
    x = [int]$r.X
    y = [int]$r.Y
    width = [int]$r.Width
    height = [int]$r.Height
    patterns = $patterns
  }
}

try {
  $root = Get-Root
  if (-not $root) { Write-Json @{ ok = $false; code = 'WINDOW_NOT_FOUND'; message = 'UIA root window not found' } 1 }

  if ($Action -eq 'list' -or $Action -eq 'find') {
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $nodes = @()
    foreach ($el in $all) {
      if ($nodes.Count -ge $MaxNodes) { break }
      $n = Get-Node $el
      if ($Class -ne '' -and $n.className -notlike "*$Class*") { continue }
      if ($Name -ne '' -and $n.name -notlike "*$Name*") { continue }
      $nodes += $n
    }
    Write-Json @{ ok = $true; action = $Action; count = $nodes.Count; nodes = $nodes }
  }

  if ($Action -eq 'invoke' -or $Action -eq 'set') {
    if ($Name -eq '') { Write-Json @{ ok = $false; code = 'USAGE'; message = '--name is required' } 1 }
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $target = $null
    foreach ($el in $all) {
      if ($el.Current.Name -eq $Name -or $el.Current.AutomationId -eq $Name) { $target = $el; break }
    }
    if (-not $target) {
      foreach ($el in $all) {
        if ($el.Current.Name -like "*$Name*") { $target = $el; break }
      }
    }
    if (-not $target) { Write-Json @{ ok = $false; code = 'UI_NOT_FOUND'; message = "control not found: $Name" } 1 }

    if ($Action -eq 'invoke') {
      $pat = $null
      if (-not $target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) {
        Write-Json @{ ok = $false; code = 'UI_NOT_EXPOSED'; message = 'InvokePattern is not available; refusing pixel fallback' } 1
      }
      $pat.Invoke()
      Write-Json @{ ok = $true; action = 'invoke'; node = (Get-Node $target) }
    }

    $pat = $null
    if (-not $target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pat)) {
      Write-Json @{ ok = $false; code = 'UI_NOT_EXPOSED'; message = 'ValuePattern is not available; refusing key/mouse fallback' } 1
    }
    $pat.SetValue($Value)
    Write-Json @{ ok = $true; action = 'set'; node = (Get-Node $target) }
  }

  Write-Json @{ ok = $false; code = 'USAGE'; message = "unknown action: $Action" } 1
} catch {
  Write-Json @{ ok = $false; code = 'UIA_ERROR'; message = $_.Exception.Message } 1
}
