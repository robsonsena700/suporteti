param(
  [Parameter(Mandatory)][string]$Owner,
  [Parameter(Mandatory)][string]$Repo,
  [string]$Token = $env:GITHUB_TOKEN,
  [string]$DevelopmentBranch = "Development",
  [string]$MainBranch = "main",
  [string]$RequiredCheck = "CI / quality"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

if ([string]::IsNullOrWhiteSpace($Token)) {
  throw "Informe um token GitHub em -Token ou na variavel GITHUB_TOKEN."
}

$headers = @{
  Authorization = "Bearer $Token"
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
}

function Set-Protection {
  param(
    [Parameter(Mandatory)][string]$Branch,
    [int]$Approvals = 1,
    [bool]$RequireCodeOwners = $true
  )

  $body = @{
    required_status_checks = @{
      strict = $true
      contexts = @($RequiredCheck)
    }
    enforce_admins = $true
    required_pull_request_reviews = @{
      dismiss_stale_reviews = $true
      require_code_owner_reviews = $RequireCodeOwners
      required_approving_review_count = $Approvals
      require_last_push_approval = $true
    }
    restrictions = $null
    required_linear_history = $false
    allow_force_pushes = $false
    allow_deletions = $false
    block_creations = $false
    required_conversation_resolution = $true
    lock_branch = $false
    allow_fork_syncing = $true
  } | ConvertTo-Json -Depth 10

  $url = "https://api.github.com/repos/$Owner/$Repo/branches/$Branch/protection"
  Write-Host "Aplicando protecao na branch $Branch..."
  Invoke-RestMethod -Method Put -Uri $url -Headers $headers -Body $body -ContentType "application/json" | Out-Null
}

Set-Protection -Branch $DevelopmentBranch -Approvals 1 -RequireCodeOwners $true
Set-Protection -Branch $MainBranch -Approvals 1 -RequireCodeOwners $true

Write-Host "Protecoes aplicadas em $Owner/$Repo para $DevelopmentBranch e $MainBranch."
