param(
  [string]$Base = "main",
  [string]$Head = "",
  [string]$Title = "",
  [string]$Body = "",
  [string]$Remote = "origin"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

function ExecGit {
  param([Parameter(Mandatory)][string[]]$Args)
  Write-Host (">> git " + ($Args -join " "))
  & git @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao executar git $($Args -join ' ')"
  }
}

function HasGhCli {
  $cmd = Get-Command gh -ErrorAction SilentlyContinue
  return $null -ne $cmd
}

ExecGit @("fetch", $Remote, "--prune") | Out-Null

if ([string]::IsNullOrWhiteSpace($Head)) {
  $Head = (& git branch --show-current).Trim()
}

if (![string]::IsNullOrWhiteSpace($Title)) {
  $prTitle = $Title
} else {
  $prTitle = "Deploy: $Head -> $Base"
}

if (![string]::IsNullOrWhiteSpace($Body)) {
  $prBody = $Body
} else {
  $prBody = "Pull Request gerado automaticamente para publicação."
}

if (!(HasGhCli)) {
  Write-Host "GitHub CLI (gh) não encontrado."
  Write-Host "Crie o PR manualmente no GitHub:"
  Write-Host "Base: $Base"
  Write-Host "Head: $Head"
  Write-Host "Título: $prTitle"
  return
}

Write-Host ">> gh pr create --base $Base --head $Head"
& gh pr create --base $Base --head $Head --title $prTitle --body $prBody
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao criar PR via gh."
}
