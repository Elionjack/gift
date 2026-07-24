param(
  [int]$Port = 0,
  [switch]$NoBrowser
)

$siteRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$portFile = Join-Path $siteRoot ".rabbit-pet-port"
$candidatePorts = [System.Collections.Generic.List[int]]::new()

if ($Port -gt 0) {
  $candidatePorts.Add($Port)
}

if ([System.IO.File]::Exists($portFile)) {
  $savedPortText = [System.IO.File]::ReadAllText($portFile).Trim()
  $savedPort = 0
  if ([int]::TryParse($savedPortText, [ref]$savedPort) -and $savedPort -gt 1024 -and -not $candidatePorts.Contains($savedPort)) {
    $candidatePorts.Add($savedPort)
  }
}

foreach ($fallbackPort in @(27531, 27631, 28531, 38081, 49153, 51807)) {
  if (-not $candidatePorts.Contains($fallbackPort)) {
    $candidatePorts.Add($fallbackPort)
  }
}

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".png" = "image/png"
  ".svg" = "image/svg+xml"
  ".ico" = "image/x-icon"
}

function Send-Response {
  param(
    [System.IO.Stream]$Stream,
    [int]$StatusCode,
    [string]$StatusText,
    [string]$ContentType,
    [byte[]]$Body,
    [bool]$HeadOnly = $false
  )

  $headerText = "HTTP/1.1 $StatusCode $StatusText`r`n" +
    "Content-Type: $ContentType`r`n" +
    "Content-Length: $($Body.Length)`r`n" +
    "Cache-Control: no-cache`r`n" +
    "Connection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $HeadOnly -and $Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
  $Stream.Flush()
}

$listener = $null
$selectedPort = 0
foreach ($candidatePort in $candidatePorts) {
  $candidateListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidatePort)
  try {
    $candidateListener.Start()
    $listener = $candidateListener
    $selectedPort = $candidatePort
    break
  } catch {
    try { $candidateListener.Stop() } catch {}
  }
}

if ($null -eq $listener) {
  Write-Host "Could not find a permitted local port." -ForegroundColor Red
  Write-Host "Windows security software or a network policy is blocking local web servers." -ForegroundColor Yellow
  Write-Host "You can still open index.html directly." -ForegroundColor Yellow
  exit 1
}

$prefix = "http://127.0.0.1:$selectedPort/"
[System.IO.File]::WriteAllText($portFile, [string]$selectedPort)

if (-not $NoBrowser) {
  try {
    Start-Process -FilePath "explorer.exe" -ArgumentList $prefix
  } catch {
    try {
      Start-Process -FilePath "rundll32.exe" -ArgumentList "url.dll,FileProtocolHandler", $prefix
    } catch {
      Write-Host "The browser could not be opened automatically." -ForegroundColor Yellow
      Write-Host "Open this address manually: $prefix" -ForegroundColor Yellow
    }
  }
}

Write-Host "Rabbit pet is running at: " -NoNewline
Write-Host $prefix -ForegroundColor Cyan
Write-Host "The selected port has been saved for future launches."
Write-Host "Close this window to stop the local server."

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new(
        $stream,
        [System.Text.Encoding]::ASCII,
        $false,
        1024,
        $true
      )

      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        continue
      }

      do {
        $headerLine = $reader.ReadLine()
      } while ($null -ne $headerLine -and $headerLine.Length -gt 0)

      $requestParts = $requestLine.Split(" ")
      if ($requestParts.Length -lt 2) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Bad Request")
        Send-Response $stream 400 "Bad Request" "text/plain; charset=utf-8" $body
        continue
      }

      $method = $requestParts[0].ToUpperInvariant()
      $headOnly = $method -eq "HEAD"
      if ($method -ne "GET" -and -not $headOnly) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Method Not Allowed")
        Send-Response $stream 405 "Method Not Allowed" "text/plain; charset=utf-8" $body
        continue
      }

      $uri = [System.Uri]::new("http://127.0.0.1" + $requestParts[1])
      $relativePath = [System.Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart("/"))
      if ([string]::IsNullOrWhiteSpace($relativePath)) {
        $relativePath = "index.html"
      }

      $candidate = [System.IO.Path]::GetFullPath((Join-Path $siteRoot $relativePath))
      if (-not $candidate.StartsWith($siteRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Forbidden")
        Send-Response $stream 403 "Forbidden" "text/plain; charset=utf-8" $body $headOnly
        continue
      }

      if (-not [System.IO.File]::Exists($candidate)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
        Send-Response $stream 404 "Not Found" "text/plain; charset=utf-8" $body $headOnly
        continue
      }

      $extension = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()
      $contentType = if ($mimeTypes.ContainsKey($extension)) {
        $mimeTypes[$extension]
      } else {
        "application/octet-stream"
      }
      $bytes = [System.IO.File]::ReadAllBytes($candidate)
      Send-Response $stream 200 "OK" $contentType $bytes $headOnly
    } catch {
      try {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Internal Server Error")
        Send-Response $stream 500 "Internal Server Error" "text/plain; charset=utf-8" $body
      } catch {}
    } finally {
      if ($null -ne $reader) { $reader.Dispose() }
      if ($null -ne $stream) { $stream.Dispose() }
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
