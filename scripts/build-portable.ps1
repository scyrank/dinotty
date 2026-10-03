# 使用方法（Windows，在仓库根目录运行）：
#   powershell -ExecutionPolicy Bypass -File .\scripts\build-portable.ps1
# 可选参数：
#   -SkipInstall                 跳过前端依赖安装
#   -Run                         打包完成后启动 dist 里的 portable 程序
#   -PublishToShared             构建并校验成功后复制稳定 portable 到共享软件目录
#   -SharedRoot <path>            共享软件根目录；默认读取 MYTOOLS_SHARED_SOFTWARE_ROOT

[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$Run,
    [switch]$PublishToShared,
    [string]$SharedRoot = $env:MYTOOLS_SHARED_SOFTWARE_ROOT
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command {
    param(
        [string]$Name,
        [string]$Hint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "未找到命令 $Name。$Hint"
    }
}

function Add-PathIfExists {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $paths = $env:PATH -split [System.IO.Path]::PathSeparator
    if ($paths -notcontains $Path) {
        $env:PATH = "$Path$([System.IO.Path]::PathSeparator)$env:PATH"
    }
}

function Invoke-External {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "命令执行失败（退出码 $LASTEXITCODE）：$FilePath $($Arguments -join ' ')"
    }
}

function Copy-VerifiedArtifact {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath,
        [switch]$AllowOverwrite
    )

    $destinationDirectory = Split-Path -Parent $DestinationPath
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    $sourceHash = (Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash
    $sourceLength = (Get-Item -LiteralPath $SourcePath).Length

    $lastError = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $temporaryName = ".{0}.{1}.tmp" -f (Split-Path -Leaf $DestinationPath), [Guid]::NewGuid()
        $temporaryPath = Join-Path $destinationDirectory $temporaryName
        try {
            if ((Test-Path -LiteralPath $DestinationPath) -and -not $AllowOverwrite) {
                $existingHash = (Get-FileHash -LiteralPath $DestinationPath -Algorithm SHA256).Hash
                if ($existingHash -ne $sourceHash) {
                    throw "目标文件已存在且 SHA-256 不同，拒绝覆盖：$DestinationPath"
                }

                Write-Host "共享目录已有相同产物，跳过覆盖：$DestinationPath" -ForegroundColor Yellow
                return
            }

            Copy-Item -LiteralPath $SourcePath -Destination $temporaryPath -Force
            $temporaryHash = (Get-FileHash -LiteralPath $temporaryPath -Algorithm SHA256).Hash
            if ($temporaryHash -ne $sourceHash) {
                throw "临时复制文件 SHA-256 校验失败：$temporaryPath"
            }
            if ((Get-Item -LiteralPath $temporaryPath).Length -ne $sourceLength) {
                throw "临时复制文件大小校验失败：$temporaryPath"
            }

            Move-Item -LiteralPath $temporaryPath -Destination $DestinationPath -Force
            $destinationHash = (Get-FileHash -LiteralPath $DestinationPath -Algorithm SHA256).Hash
            if ($destinationHash -ne $sourceHash -or (Get-Item -LiteralPath $DestinationPath).Length -ne $sourceLength) {
                throw "共享目录目标文件校验失败：$DestinationPath"
            }

            Write-Host "已复制并校验共享产物：$DestinationPath" -ForegroundColor Green
            return
        } catch {
            $lastError = $_
            if ($attempt -lt 3) {
                Start-Sleep -Milliseconds 500
            }
        } finally {
            if (Test-Path -LiteralPath $temporaryPath) {
                Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
            }
        }
    }

    throw "复制共享产物失败（已重试 3 次）：$DestinationPath。请确认目标程序未运行且文件未被占用。原始错误：$($lastError.Exception.Message)"
}

function Resolve-SharedRoot {
    param([string]$ConfiguredRoot)

    if ([string]::IsNullOrWhiteSpace($ConfiguredRoot)) {
        throw "已启用 -PublishToShared，但未提供共享根目录。请设置 MYTOOLS_SHARED_SOFTWARE_ROOT 或传入 -SharedRoot。"
    }

    $expandedRoot = [Environment]::ExpandEnvironmentVariables($ConfiguredRoot).Trim()
    if (-not (Test-Path -LiteralPath $expandedRoot -PathType Container)) {
        throw "共享根目录不存在或不是目录：$expandedRoot"
    }

    return (Resolve-Path -LiteralPath $expandedRoot).Path
}

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
    throw "portable Windows 包需要在 Windows 上构建。"
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$frontendDir = Join-Path $repoRoot "frontend"
$tauriDir = Join-Path $repoRoot "src-tauri"
$distDir = Join-Path $repoRoot "dist"
$previousLocation = Get-Location
$temporaryTauriConfig = $null

try {
    Set-Location $repoRoot

    Add-PathIfExists (Join-Path $env:USERPROFILE ".cargo\bin")

    Require-Command "pnpm" "请先安装 pnpm，或启用 corepack 后重试。"
    Require-Command "cargo" "请先安装 Rust 工具链，或确认 %USERPROFILE%\.cargo\bin 已加入 PATH 后重试。"
    Require-Command "cargo-tauri" '请先运行 cargo install tauri-cli --version "^2" 安装 Tauri CLI。'

    $metadataJson = & cargo metadata --locked --no-deps --format-version 1
    if ($LASTEXITCODE -ne 0) {
        throw "cargo metadata --locked 执行失败。"
    }
    $metadata = $metadataJson | ConvertFrom-Json
    $memberIds = @($metadata.workspace_members)
    $workspacePackages = @(
        $metadata.packages |
            Where-Object {
                $memberIds -contains $_.id -and
                $_.name -in @("dinotty-server", "dinotty-desktop")
            }
    )
    $versions = @(
        $workspacePackages |
            Select-Object -ExpandProperty version -Unique
    )
    $hasExpectedPackages =
        $workspacePackages.Count -eq 2 -and
        @($workspacePackages | Where-Object { $_.name -eq "dinotty-server" }).Count -eq 1 -and
        @($workspacePackages | Where-Object { $_.name -eq "dinotty-desktop" }).Count -eq 1
    if (-not $hasExpectedPackages -or $versions.Count -ne 1 -or $versions[0] -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
        throw "未能从 Cargo workspace 解析唯一的 server/desktop 版本号。"
    }
    $version = $versions[0]

    if (-not $SkipInstall) {
        Write-Step "安装前端依赖"
        Push-Location $frontendDir
        try {
            Invoke-External "pnpm" @("install", "--frozen-lockfile")
        } finally {
            Pop-Location
        }
    }

    Write-Step "构建前端"
    Push-Location $frontendDir
    try {
        Invoke-External "pnpm" @("build")
    } finally {
        Pop-Location
    }

    # tauri.conf.json 中的 hook 从仓库根目录执行，不能使用相对于 src-tauri 的 ../frontend。
    # 前端已在上一步构建；用临时配置只为本次构建禁用该 hook。
    $temporaryTauriConfig = New-TemporaryFile
    [System.IO.File]::WriteAllText(
        $temporaryTauriConfig.FullName,
        '{"build":{"beforeBuildCommand":null}}',
        (New-Object System.Text.UTF8Encoding($false))
    )

    Write-Step "构建 Tauri portable 可执行文件"
    Push-Location $repoRoot
    try {
        # Portable 包只需要 release exe，无需额外生成 NSIS 安装程序。
        Invoke-External "cargo" @(
            "tauri", "build",
            "--no-bundle",
            "--ci",
            "--config", $temporaryTauriConfig.FullName,
            "--", "--locked"
        )
    } finally {
        Pop-Location
    }

    $targetDir = [string]$metadata.target_directory
    $exeCandidates = @(
        (Join-Path $targetDir "release\dinotty-desktop.exe"),
        (Join-Path $repoRoot "target\release\dinotty-desktop.exe"),
        (Join-Path $tauriDir "target\release\dinotty-desktop.exe")
    ) | Select-Object -Unique
    $exePath = $exeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $exePath) {
        throw "未找到 release 可执行文件 dinotty-desktop.exe（Cargo target 目录：$targetDir）。"
    }

    $rustcVersion = & rustc -vV
    if ($LASTEXITCODE -ne 0) {
        throw "rustc -vV 执行失败。"
    }
    $hostLine = $rustcVersion | Where-Object { $_ -like "host:*" } | Select-Object -First 1
    if (-not $hostLine) {
        throw "未能从 rustc -vV 解析 Rust host 架构。"
    }
    $rustHost = ($hostLine -replace '^host:\s*', '').Trim()
    $arch = switch -Regex ($rustHost) {
        '^x86_64-' { "x64"; break }
        '^aarch64-' { "arm64"; break }
        '^i[3-6]86-' { "x86"; break }
        default { ($rustHost -split '-', 2)[0].ToLowerInvariant() }
    }

    New-Item -ItemType Directory -Path $distDir -Force | Out-Null

    # Tauri 当前没有单独的 portable bundle。输出一个稳定文件名供快捷方式/
    # 自启动使用，同时保留带版本号的副本用于归档和 Release。
    $portableNames = @(
        "Dinotty_{0}-portable.exe" -f $arch
        "Dinotty_{0}_{1}-portable.exe" -f $version, $arch
    )
    $portablePaths = $portableNames | ForEach-Object { Join-Path $distDir $_ }
    try {
        foreach ($path in $portablePaths) {
            Copy-Item -LiteralPath $exePath -Destination $path -Force
        }
    } catch [System.IO.IOException] {
        throw "无法写入 portable 产物。请先关闭正在运行的 portable 程序，然后重试。原始错误：$($_.Exception.Message)"
    }

    $releaseHash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash
    foreach ($path in $portablePaths) {
        $portableHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        if ($releaseHash -ne $portableHash) {
            throw "portable 产物校验失败：$path 与本次 release 构建不一致。"
        }
    }

    if ($PublishToShared) {
        $sharedRootPath = Resolve-SharedRoot $SharedRoot
        $sharedDirectory = Join-Path $sharedRootPath "dinotty"
        $sharedPortablePath = Join-Path $sharedDirectory (Split-Path -Leaf $portablePaths[0])

        $runningProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
                $_.ProcessName -in @("dinotty-desktop", "Dinotty")
            })
        if ($runningProcesses.Count -gt 0) {
            throw "检测到 Dinotty 进程仍在运行，无法安全更新共享 portable。请先关闭程序后重试。"
        }

        Copy-VerifiedArtifact -SourcePath $portablePaths[0] -DestinationPath $sharedPortablePath -AllowOverwrite
    }

    Write-Host ""
    Write-Host "portable 包已生成：" -ForegroundColor Green
    foreach ($path in $portablePaths) {
        Write-Host "  $path"
    }

    if ($Run) {
        Write-Step "启动 portable 程序"
        Start-Process -FilePath $portablePaths[0] -WorkingDirectory $distDir
    }
} finally {
    if ($temporaryTauriConfig -and (Test-Path -LiteralPath $temporaryTauriConfig.FullName)) {
        Remove-Item -LiteralPath $temporaryTauriConfig.FullName -Force
    }
    Set-Location $previousLocation
}
