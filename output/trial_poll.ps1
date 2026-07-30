$ErrorActionPreference = "Continue"
$uid = "1266288955662405634"
$tok = "20fef236f5671749623e32a99c54e28a0de64dfa98cf9aeccbc8b51349c86975"
$chatId = "83d6e9b2-342f-4ef6-97f2-7ec924084d66"
$needle = "trial 051008"
$outDir = Join-Path $PSScriptRoot "."
$found = $null
$lastHistory = $null

function Get-MsgText($msg) {
  $parts = @()
  foreach ($k in @("content", "prompt", "text", "message", "caption")) {
    if ($null -ne $msg.$k) { $parts += [string]$msg.$k }
  }
  return ($parts -join " ")
}

function Get-MsgMedia($msg) {
  if ($msg.image) { return [string]$msg.image }
  if ($msg.media) { return [string]$msg.media }
  if ($msg.imageUrl) { return [string]$msg.imageUrl }
  if ($msg.url) { return [string]$msg.url }
  if ($msg.images -and $msg.images.Count -gt 0) {
    $first = $msg.images[0]
    if ($first -is [string]) { return $first }
    if ($first.url) { return [string]$first.url }
    if ($first.image) { return [string]$first.image }
  }
  if ($msg.attachments -and $msg.attachments.Count -gt 0) {
    $a = $msg.attachments[0]
    if ($a.url) { return [string]$a.url }
    if ($a -is [string]) { return $a }
  }
  return $null
}

for ($i = 1; $i -le 40; $i++) {
  Start-Sleep -Seconds 3
  $url = "https://www.dafreeai.site/api/history/${uid}?userId=${uid}&token=${tok}&limit=30&offset=0"
  try {
    $h = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 60
    $lastHistory = $h
  } catch {
    Write-Host "[poll $i] history error: $_"
    continue
  }

  $active = $h.activeGeneration
  $cnt = $h.activeGenerationsCount
  $nChats = @($h.history).Count
  Write-Host "[poll $i] active=$active count=$cnt chats=$nChats"

  foreach ($chat in @($h.history)) {
    $cid = [string]$chat.id
    $title = [string]$chat.title
    foreach ($msg in @($chat.messages)) {
      $role = [string]$msg.role
      $loading = [bool]$msg.isLoading
      $err = [bool]$msg.isError
      $model = [string]$msg.modelName
      if (-not $model) { $model = [string]$msg.model }
      $text = Get-MsgText $msg
      $img = Get-MsgMedia $msg
      $hitPrompt = ($text -like "*$needle*") -or ($title -like "*$needle*")
      $hitChat = ($cid -eq $chatId)
      $isBot = ($role -match "bot|assistant")
      $imgOk = $img -and ($img -notmatch "placeholder|loading|^null$")

      if (($hitPrompt -or $hitChat) -and $isBot -and (-not $loading) -and (-not $err) -and $imgOk) {
        $via = if ($hitChat) { "exact_chat" } else { "prompt_library" }
        $snip = if ($text.Length -gt 120) { $text.Substring(0, 120) } else { $text }
        $found = [ordered]@{
          poll = $i
          chatId = $cid
          title = $title
          model = $model
          media = $img
          matchedVia = $via
          promptSnippet = $snip
          role = $role
        }
        break
      }
    }
    if ($found) { break }
  }
  if ($found) { break }
}

if ($found) {
  $foundPath = Join-Path $outDir "trial_generate_found.json"
  ($found | ConvertTo-Json -Depth 10) | Set-Content -Encoding utf8 $foundPath
  Write-Host "FOUND media=$($found.media)"
  Write-Host "matchedVia=$($found.matchedVia) chatId=$($found.chatId)"

  $media = [string]$found.media
  if ($media.StartsWith("/")) {
    $mediaUrl = "https://www.dafreeai.site$media"
  } elseif ($media -match "^https?://") {
    $mediaUrl = $media
  } else {
    $mediaUrl = "https://www.dafreeai.site/api/images/$media"
  }
  # Prefer authenticated image path style if relative path under /api/images
  if ($media -match "^/api/images/") {
    $mediaUrl = "https://www.dafreeai.site$media"
  }

  $imgOut = Join-Path $outDir "trial_nano_banana_2_lite.png"
  try {
    Invoke-WebRequest -Uri $mediaUrl -OutFile $imgOut -TimeoutSec 120
    $len = (Get-Item $imgOut).Length
    Write-Host "DOWNLOADED $imgOut bytes=$len"
    $found.mediaUrl = $mediaUrl
    $found.savedAs = $imgOut
    $found.bytes = $len
    ($found | ConvertTo-Json -Depth 10) | Set-Content -Encoding utf8 $foundPath
  } catch {
    Write-Host "DOWNLOAD_FAIL: $_"
    # retry with query auth
    try {
      $sep = if ($mediaUrl.Contains("?")) { "&" } else { "?" }
      $authUrl = "$mediaUrl${sep}userId=$uid&token=$tok"
      Invoke-WebRequest -Uri $authUrl -OutFile $imgOut -TimeoutSec 120
      $len = (Get-Item $imgOut).Length
      Write-Host "DOWNLOADED_AUTH $imgOut bytes=$len"
      $found.mediaUrl = $authUrl
      $found.savedAs = $imgOut
      $found.bytes = $len
      ($found | ConvertTo-Json -Depth 10) | Set-Content -Encoding utf8 $foundPath
    } catch {
      Write-Host "DOWNLOAD_AUTH_FAIL: $_"
      Write-Host "MEDIA_URL=$mediaUrl"
    }
  }
} else {
  Write-Host "NOT_FOUND_AFTER_POLLS"
  if ($lastHistory) {
    $lastPath = Join-Path $outDir "trial_generate_history_last.json"
    ($lastHistory | ConvertTo-Json -Depth 12) | Set-Content -Encoding utf8 $lastPath
    Write-Host "wrote $lastPath"
  }
}
