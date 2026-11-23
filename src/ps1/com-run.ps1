param(
    [Parameter(Mandatory = $true)][string]$JsxPath,
    [Parameter(Mandatory = $true)][string]$ResultPath,
    [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
$ps = $null
$envelope = $null

try {
    if (-not (Test-Path -LiteralPath $JsxPath)) {
        throw "JSX file not found: $JsxPath"
    }

    $ps = New-Object -ComObject Photoshop.Application
    $result = $ps.DoJavaScriptFile($JsxPath)
    $envelope = [ordered]@{
        ok     = $true
        result = [string]$result
    }
}
catch {
    $errMessage = $_.Exception.Message
    $errHResult = $null
    $errCategory = $null
    try { $errHResult = $_.Exception.HResult } catch { }
    try { $errCategory = [string]$_.CategoryInfo.Category } catch { }
    $envelope = [ordered]@{
        ok       = $false
        error    = $errMessage
        hresult  = $errHResult
        category = $errCategory
    }
}
finally {
    if ($null -ne $ps) {
        try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($ps) } catch { }
    }
}

$json = $envelope | ConvertTo-Json -Compress -Depth 6
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ResultPath, $json, $utf8)
