#Requires -Version 5.1
<#
.SYNOPSIS
    Build and push multi-platform Docker images for Quilttap.
.DESCRIPTION
    Mirrors scripts/build-push-docker.sh for Windows environments.
    Builds native and cross-platform images, pushes them, and creates
    multi-platform manifests on Docker Hub.
#>

$ErrorActionPreference = 'Stop'

# Get version from package.json
$NEWRELEASE = node -e "console.log(require('./package.json').version)"
if ($LASTEXITCODE -ne 0) { throw "Failed to read version from package.json" }

# Determine branch and channel tag
$BRANCH = git rev-parse --abbrev-ref HEAD
if ($LASTEXITCODE -ne 0) { throw "Failed to determine git branch" }

if ($BRANCH -eq 'release') {
    $CHANNEL = 'latest'
} elseif ($BRANCH -eq 'main') {
    $CHANNEL = 'dev'
} else {
    # Use the part after the last slash, or the whole name if no slashes
    $CHANNEL = ($BRANCH -split '/')[-1]
}

Write-Host "Version: $NEWRELEASE"
Write-Host "Branch:  $BRANCH"
Write-Host "Channel: $CHANNEL"

$BUILDPLATFORM = node -e "console.log(process.arch)"
if ($LASTEXITCODE -ne 0) { throw "Failed to detect platform" }

docker login
if ($LASTEXITCODE -ne 0) { throw "Docker login failed" }

if ($BUILDPLATFORM -eq 'x64') {
    $NATIVE = 'amd64'
    $FOREIGN = 'arm64'
} elseif ($BUILDPLATFORM -eq 'arm64') {
    $NATIVE = 'arm64'
    $FOREIGN = 'amd64'
} else {
    throw "Unknown platform: $BUILDPLATFORM"
}

# Build native image with regular docker (fast)
docker build -t "csebold/quilltap:$NEWRELEASE-$NATIVE" -t "csebold/quilltap:$CHANNEL-$NATIVE" .
if ($LASTEXITCODE -ne 0) { throw "Native docker build failed" }

docker push "csebold/quilltap:$NEWRELEASE-$NATIVE"
if ($LASTEXITCODE -ne 0) { throw "Failed to push $NEWRELEASE-$NATIVE" }

docker push "csebold/quilltap:$CHANNEL-$NATIVE"
if ($LASTEXITCODE -ne 0) { throw "Failed to push $CHANNEL-$NATIVE" }

# Build foreign image with buildx (emulated, slower)
docker buildx build --platform "linux/$FOREIGN" --tag "csebold/quilltap:$NEWRELEASE-$FOREIGN" --tag "csebold/quilltap:$CHANNEL-$FOREIGN" --push .
if ($LASTEXITCODE -ne 0) { throw "Foreign buildx build failed" }

# Create multi-platform manifests
docker buildx imagetools create --tag "csebold/quilltap:$NEWRELEASE" "csebold/quilltap:$NEWRELEASE-amd64" "csebold/quilltap:$NEWRELEASE-arm64"
if ($LASTEXITCODE -ne 0) { throw "Failed to create version manifest" }

docker buildx imagetools create --tag "csebold/quilltap:$CHANNEL" "csebold/quilltap:$CHANNEL-amd64" "csebold/quilltap:$CHANNEL-arm64"
if ($LASTEXITCODE -ne 0) { throw "Failed to create channel manifest" }

Write-Host ""
Write-Host "Done! Pushed:"
Write-Host "  csebold/quilltap:$NEWRELEASE (amd64 + arm64)"
Write-Host "  csebold/quilltap:$CHANNEL (amd64 + arm64)"
