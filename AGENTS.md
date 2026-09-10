# Dinotty 工程约定

## Windows Release 构建与发布

- 正式 Release 的 Windows 产物必须在本机 Windows 环境中，从准备发布的最终提交或正式标签编译。不要使用 GitHub Actions 编译的 Windows artifact 代替本机产物，除非用户明确要求。
- 上传 GitHub Release 前必须确认源码版本号、正式标签和待发布版本一致，并确认本机工作区没有会混入构建的未提交源码改动。
- 编译前关闭所有正在运行的 Dinotty 进程，避免 portable 文件被占用。
- 每个 Windows Release 必须生成以下 3 个产物；`<version>` 取 Cargo workspace 版本，`<arch>` 取本机 Rust host 架构（常用值为 `x64`）：
  1. `dist\Dinotty_<version>_<arch>-portable.exe`：带版本号的 portable。
  2. `dist\Dinotty_<arch>-portable.exe`：不带版本号的 portable。
  3. `target\release\bundle\nsis\Dinotty_<version>_<arch>-setup.exe`：Windows NSIS 安装包。
- 使用 `powershell -ExecutionPolicy Bypass -File .\scripts\build-portable.ps1` 在本机生成两份 portable；只有依赖已通过锁文件安装完毕时才可以加 `-SkipInstall`。
- 使用 `cargo tauri build --bundles nsis --ci -- --locked` 在本机生成 Windows NSIS 安装包。若构建前端依赖尚未安装，先在 `frontend` 目录执行 `pnpm install --frozen-lockfile`。
- 构建成功后，必须逐一确认上述 3 个文件存在，并至少核对文件大小和 SHA-256。两个 portable 应来自同一个本次 release 可执行文件，因此 SHA-256 必须相同。
- 将不带版本号的 `dist\Dinotty_<arch>-portable.exe` 复制到 `D:\GitHub\Khala\dinotty\Dinotty_<arch>-portable.exe`，允许覆盖旧版本；只能在本次构建成功且哈希验证通过后覆盖。
- 将上述 3 个本机 Windows 产物上传到对应版本的 GitHub Release，并在上传后核对远端资产的文件名、大小、SHA-256 和上传状态。不要上传旧构建或 GitHub Actions 生成的同名 Windows 文件。
- 推送 `v*` 标签会触发现有 `.github/workflows/package.yml`。即使该工作流产生了 Windows artifact，正式 Release 仍以上述本机产物为准；发布前应检查 Release 中是否已有自动上传的同名资产，避免混用或重复。

