pub trait CommandNoWindowExt {
    fn no_window(&mut self) -> &mut Self;

    /// Suppress a console window without detaching the child from piped stdio.
    fn no_window_with_stdio(&mut self) -> &mut Self;
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x0000_0008;
#[cfg(windows)]
// GUI builds have no parent console; detach background CLI tools so Windows
// does not create transient conhost windows for each short-lived command.
const NO_CONSOLE_WINDOW_FLAGS: u32 = CREATE_NO_WINDOW | DETACHED_PROCESS;

impl CommandNoWindowExt for std::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(NO_CONSOLE_WINDOW_FLAGS);
        }
        self
    }

    fn no_window_with_stdio(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

impl CommandNoWindowExt for tokio::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            self.creation_flags(NO_CONSOLE_WINDOW_FLAGS);
        }
        self
    }

    fn no_window_with_stdio(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

/// Foreground TUI families whose image-paste shortcuts differ on Windows.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardPasteTarget {
    Claude,
    OpenCode,
    #[default]
    Unknown,
}

#[derive(Clone, Debug)]
struct ProcessDescriptor {
    pid: u32,
    parent_pid: Option<u32>,
    name: String,
    command_line: String,
}

fn classify_clipboard_paste_process(
    name: &str,
    command_line: &str,
) -> Option<ClipboardPasteTarget> {
    let normalized_name = name.replace('\\', "/").to_ascii_lowercase();
    let executable = normalized_name
        .rsplit('/')
        .next()
        .unwrap_or(normalized_name.as_str())
        .trim_end_matches(".exe")
        .trim_end_matches(".com");
    let command = command_line.replace('\\', "/").to_ascii_lowercase();

    if executable == "claude" || command.contains("@anthropic-ai/claude-code") {
        return Some(ClipboardPasteTarget::Claude);
    }
    if executable == "opencode" || command.contains("node_modules/opencode-ai/") {
        return Some(ClipboardPasteTarget::OpenCode);
    }
    None
}

fn classify_clipboard_paste_process_tree(
    root_pid: u32,
    processes: &[ProcessDescriptor],
) -> ClipboardPasteTarget {
    use std::collections::{HashMap, HashSet, VecDeque};

    let by_pid: HashMap<u32, &ProcessDescriptor> =
        processes.iter().map(|process| (process.pid, process)).collect();
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for process in processes {
        if let Some(parent_pid) = process.parent_pid {
            children.entry(parent_pid).or_default().push(process.pid);
        }
    }
    for process_children in children.values_mut() {
        process_children.sort_unstable();
    }

    let mut pending = VecDeque::from([root_pid]);
    let mut visited = HashSet::new();
    while let Some(pid) = pending.pop_front() {
        if !visited.insert(pid) {
            continue;
        }
        if let Some(process) = by_pid.get(&pid) {
            if let Some(target) =
                classify_clipboard_paste_process(&process.name, &process.command_line)
            {
                return target;
            }
        }
        if let Some(process_children) = children.get(&pid) {
            pending.extend(process_children);
        }
    }

    ClipboardPasteTarget::Unknown
}

/// Inspect the local process tree rooted at a PTY child and identify the nearest
/// TUI with a non-standard image-paste shortcut.
#[must_use]
pub fn clipboard_paste_target_for_process_tree(root_pid: u32) -> ClipboardPasteTarget {
    #[cfg(windows)]
    {
        let system = sysinfo::System::new_all();
        let processes: Vec<ProcessDescriptor> = system
            .processes()
            .iter()
            .map(|(pid, process)| ProcessDescriptor {
                pid: pid.as_u32(),
                parent_pid: process.parent().map(sysinfo::Pid::as_u32),
                name: process.name().to_string_lossy().into_owned(),
                command_line: process
                    .cmd()
                    .iter()
                    .map(|part| part.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" "),
            })
            .collect();
        classify_clipboard_paste_process_tree(root_pid, &processes)
    }

    #[cfg(not(windows))]
    {
        let _ = root_pid;
        ClipboardPasteTarget::Unknown
    }
}

#[cfg(test)]
mod clipboard_paste_target_tests {
    use super::{
        classify_clipboard_paste_process, classify_clipboard_paste_process_tree,
        ClipboardPasteTarget, ProcessDescriptor,
    };

    fn process(
        pid: u32,
        parent_pid: Option<u32>,
        name: &str,
        command_line: &str,
    ) -> ProcessDescriptor {
        ProcessDescriptor { pid, parent_pid, name: name.into(), command_line: command_line.into() }
    }

    #[test]
    fn recognizes_native_and_node_tui_processes() {
        for (name, command, expected) in [
            (
                "claude.exe",
                r#""C:\Users\test\.local\bin\claude.exe" -c"#,
                ClipboardPasteTarget::Claude,
            ),
            (
                "node.exe",
                r#"node C:\npm\node_modules\@anthropic-ai\claude-code\cli.js"#,
                ClipboardPasteTarget::Claude,
            ),
            (
                "opencode.exe",
                r#"D:\npm\node_modules\opencode-ai\bin\opencode.exe"#,
                ClipboardPasteTarget::OpenCode,
            ),
            (
                "node.exe",
                r#"node D:\npm\node_modules\opencode-ai\bin\opencode"#,
                ClipboardPasteTarget::OpenCode,
            ),
        ] {
            assert_eq!(classify_clipboard_paste_process(name, command), Some(expected));
        }
    }

    #[test]
    fn ignores_unrelated_process_names_and_arguments() {
        assert_eq!(
            classify_clipboard_paste_process("cargo.exe", "cargo test claude opencode"),
            None
        );
    }

    #[test]
    fn chooses_the_nearest_recognized_descendant() {
        let processes = vec![
            process(10, None, "pwsh.exe", "pwsh"),
            process(20, Some(10), "claude.exe", "claude -c"),
            process(30, Some(20), "opencode.exe", "opencode"),
        ];

        assert_eq!(
            classify_clipboard_paste_process_tree(10, &processes),
            ClipboardPasteTarget::Claude
        );
    }

    #[test]
    fn recognizes_an_opencode_shim_below_the_pty_shell() {
        let processes = vec![
            process(10, None, "pwsh.exe", "pwsh"),
            process(
                20,
                Some(10),
                "cmd.exe",
                r#"cmd /c D:\npm\node_modules\opencode-ai\bin\opencode.exe"#,
            ),
        ];

        assert_eq!(
            classify_clipboard_paste_process_tree(10, &processes),
            ClipboardPasteTarget::OpenCode
        );
    }

    #[test]
    fn ignores_recognized_processes_outside_the_pty_tree() {
        let processes = vec![
            process(10, None, "pwsh.exe", "pwsh"),
            process(20, Some(10), "git.exe", "git status"),
            process(30, None, "claude.exe", "claude"),
        ];

        assert_eq!(
            classify_clipboard_paste_process_tree(10, &processes),
            ClipboardPasteTarget::Unknown
        );
    }
}

/// Resolve a program used by the direct terminal argv API.
///
/// Unix keeps the existing `execvp`-style behavior. Windows resolves only
/// native executables before handing the absolute path to portable-pty, whose
/// own PATH lookup otherwise prefers extensionless Unix shims and batch files.
///
/// # Errors
///
/// On Windows, returns an error when `program` is a script, is not a native
/// `.exe`/`.com` path, or cannot be resolved to a native executable on `PATH`.
pub fn resolve_terminal_program(
    program: &std::ffi::OsStr,
    cwd: &std::path::Path,
) -> Result<std::ffi::OsString, String> {
    #[cfg(windows)]
    {
        resolve_windows_native_program_from(
            program,
            std::env::var_os("PATH").as_deref(),
            std::env::var_os("PATHEXT").as_deref(),
            cwd,
        )
    }

    #[cfg(not(windows))]
    {
        let _ = cwd;
        Ok(program.to_os_string())
    }
}

#[cfg(windows)]
fn resolve_windows_native_program_from(
    program: &std::ffi::OsStr,
    search_path: Option<&std::ffi::OsStr>,
    path_ext: Option<&std::ffi::OsStr>,
    cwd: &std::path::Path,
) -> Result<std::ffi::OsString, String> {
    use std::path::Path;

    fn extension_kind(path: &Path) -> Option<String> {
        path.extension().map(|value| value.to_string_lossy().to_ascii_lowercase())
    }

    fn is_native_extension(extension: Option<&str>) -> bool {
        matches!(extension, Some("exe" | "com"))
    }

    fn is_script_extension(extension: Option<&str>) -> bool {
        matches!(extension, Some("cmd" | "bat" | "ps1"))
    }

    fn resolved_file(path: &Path, cwd: &Path) -> Option<std::ffi::OsString> {
        let absolute = if path.is_absolute() { path.to_path_buf() } else { cwd.join(path) };
        if !absolute.is_file() {
            return None;
        }
        Some(absolute.into_os_string())
    }

    let requested = Path::new(program);
    let extension = extension_kind(requested);
    if is_script_extension(extension.as_deref()) {
        return Err(format!(
            "terminal argv[0] is a Windows script and cannot be launched directly: {}",
            requested.display()
        ));
    }

    let has_path = requested.is_absolute() || requested.components().count() > 1;
    if has_path {
        if !is_native_extension(extension.as_deref()) {
            return Err(format!(
                "terminal argv[0] must be a native .exe or .com executable on Windows: {}",
                requested.display()
            ));
        }
        return resolved_file(requested, cwd).ok_or_else(|| {
            format!("terminal native executable was not found: {}", requested.display())
        });
    }

    // The terminal API accepts a caller-controlled cwd. Relative PATH entries
    // (including `.` and empty entries) would make a bare program name resolve
    // inside that cwd, allowing a workspace file to impersonate a trusted
    // native executable such as cmd.exe. Direct argv execution therefore only
    // searches absolute PATH entries on Windows.
    let directories = search_path
        .into_iter()
        .flat_map(std::env::split_paths)
        .filter(|directory| directory.is_absolute());
    if is_native_extension(extension.as_deref()) {
        for directory in directories {
            let candidate = directory.join(requested);
            if let Some(resolved) = resolved_file(&candidate, cwd) {
                return Ok(resolved);
            }
        }
    } else {
        let mut native_extensions: Vec<&str> = path_ext
            .and_then(std::ffi::OsStr::to_str)
            .into_iter()
            .flat_map(|value| value.split(';'))
            .filter_map(|value| match value.trim().to_ascii_lowercase().as_str() {
                ".com" => Some(".COM"),
                ".exe" => Some(".EXE"),
                _ => None,
            })
            .collect();
        if native_extensions.is_empty() {
            native_extensions.extend([".COM", ".EXE"]);
        }

        for directory in directories {
            for extension in &native_extensions {
                let mut file_name = program.to_os_string();
                file_name.push(extension);
                let candidate = directory.join(file_name);
                if let Some(resolved) = resolved_file(&candidate, cwd) {
                    return Ok(resolved);
                }
            }
        }
    }

    Err(format!(
        "terminal argv[0] did not resolve to a native .exe or .com executable on Windows: {}",
        requested.display()
    ))
}

#[cfg(all(test, windows))]
mod tests {
    use std::{ffi::OsStr, fs};

    use super::resolve_windows_native_program_from;

    #[test]
    fn bare_program_skips_extensionless_and_script_shims_for_a_later_exe() {
        let temp = tempfile::tempdir().unwrap();
        let poison = temp.path().join("poison");
        let native = temp.path().join("native");
        fs::create_dir_all(&poison).unwrap();
        fs::create_dir_all(&native).unwrap();
        fs::write(poison.join("tool"), b"#!/bin/sh\n").unwrap();
        fs::write(poison.join("tool.cmd"), b"@echo off\r\n").unwrap();
        fs::write(native.join("tool.exe"), b"fixture").unwrap();
        let search_path = std::env::join_paths([&poison, &native]).unwrap();

        let resolved = resolve_windows_native_program_from(
            OsStr::new("tool"),
            Some(&search_path),
            Some(OsStr::new(".COM;.EXE;.BAT;.CMD")),
            temp.path(),
        )
        .unwrap();

        assert!(
            resolved
                .to_string_lossy()
                .eq_ignore_ascii_case(&native.join("tool.exe").to_string_lossy()),
            "{resolved:?}"
        );
    }

    #[test]
    fn explicit_exe_name_is_not_replaced_by_an_earlier_cmd() {
        let temp = tempfile::tempdir().unwrap();
        let poison = temp.path().join("poison");
        let native = temp.path().join("native");
        fs::create_dir_all(&poison).unwrap();
        fs::create_dir_all(&native).unwrap();
        fs::write(poison.join("tool.cmd"), b"@echo off\r\n").unwrap();
        fs::write(native.join("tool.exe"), b"fixture").unwrap();
        let search_path = std::env::join_paths([&poison, &native]).unwrap();

        let resolved = resolve_windows_native_program_from(
            OsStr::new("tool.exe"),
            Some(&search_path),
            Some(OsStr::new(".CMD;.EXE")),
            temp.path(),
        )
        .unwrap();

        assert_eq!(resolved, native.join("tool.exe").into_os_string());
    }

    #[test]
    fn bare_program_ignores_relative_path_entries_and_cwd_poisoning() {
        let temp = tempfile::tempdir().unwrap();
        let cwd = temp.path().join("workspace");
        let native = temp.path().join("native");
        fs::create_dir_all(&cwd).unwrap();
        fs::create_dir_all(&native).unwrap();
        fs::write(cwd.join("cmd.exe"), b"workspace poison").unwrap();
        fs::write(native.join("cmd.exe"), b"trusted fixture").unwrap();
        let search_path = std::env::join_paths([
            std::path::Path::new("."),
            std::path::Path::new("relative-bin"),
            &native,
        ])
        .unwrap();

        let resolved = resolve_windows_native_program_from(
            OsStr::new("cmd.exe"),
            Some(&search_path),
            Some(OsStr::new(".EXE")),
            &cwd,
        )
        .unwrap();

        assert_eq!(resolved, native.join("cmd.exe").into_os_string());
    }

    #[test]
    fn dotted_bare_name_can_resolve_by_appending_a_native_extension() {
        let temp = tempfile::tempdir().unwrap();
        let native = temp.path().join("native");
        fs::create_dir_all(&native).unwrap();
        fs::write(native.join("tool.v2.exe"), b"fixture").unwrap();
        let search_path = std::env::join_paths([&native]).unwrap();

        let resolved = resolve_windows_native_program_from(
            OsStr::new("tool.v2"),
            Some(&search_path),
            Some(OsStr::new(".EXE")),
            temp.path(),
        )
        .unwrap();

        assert!(
            resolved
                .to_string_lossy()
                .eq_ignore_ascii_case(&native.join("tool.v2.exe").to_string_lossy()),
            "{resolved:?}"
        );
    }

    #[test]
    fn explicit_native_path_with_spaces_and_unicode_is_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let program = temp.path().join("space dir").join("工具.exe");
        fs::create_dir_all(program.parent().unwrap()).unwrap();
        fs::write(&program, b"fixture").unwrap();

        let resolved =
            resolve_windows_native_program_from(program.as_os_str(), None, None, temp.path())
                .unwrap();

        assert_eq!(resolved, program.into_os_string());
    }

    #[test]
    fn explicit_namespaced_native_path_is_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let program = temp.path().join("native.exe");
        fs::write(&program, b"fixture").unwrap();
        let namespaced = std::path::PathBuf::from(format!(r"\\?\{}", program.display()));

        let resolved =
            resolve_windows_native_program_from(namespaced.as_os_str(), None, None, temp.path())
                .unwrap();

        assert_eq!(resolved, namespaced.into_os_string());
    }

    #[test]
    fn script_programs_are_rejected_instead_of_entering_a_shell() {
        for program in ["tool.cmd", "tool.bat", "tool.ps1"] {
            let error = resolve_windows_native_program_from(
                OsStr::new(program),
                None,
                None,
                std::path::Path::new(r"C:\work"),
            )
            .unwrap_err();
            assert!(error.contains("script"), "{program}: {error}");
        }
    }

    #[test]
    fn missing_native_program_has_an_actionable_error() {
        let error = resolve_windows_native_program_from(
            OsStr::new("missing-tool"),
            Some(OsStr::new("")),
            Some(OsStr::new(".EXE;.COM")),
            std::path::Path::new(r"C:\work"),
        )
        .unwrap_err();

        assert!(error.contains("native .exe or .com"), "{error}");
    }

    #[test]
    fn explicit_relative_native_path_resolves_from_terminal_cwd_without_path_fallback() {
        let temp = tempfile::tempdir().unwrap();
        let cwd = temp.path().join("workspace");
        let path_dir = temp.path().join("path");
        fs::create_dir_all(cwd.join("bin")).unwrap();
        fs::create_dir_all(&path_dir).unwrap();
        fs::write(cwd.join("bin").join("tool.exe"), b"cwd fixture").unwrap();
        fs::write(path_dir.join("missing.exe"), b"path fixture").unwrap();
        let search_path = std::env::join_paths([&path_dir]).unwrap();

        let resolved = resolve_windows_native_program_from(
            OsStr::new(r"bin\tool.exe"),
            Some(&search_path),
            Some(OsStr::new(".EXE")),
            &cwd,
        )
        .unwrap();
        assert_eq!(resolved, cwd.join("bin").join("tool.exe").into_os_string());

        let error = resolve_windows_native_program_from(
            OsStr::new(r"bin\missing.exe"),
            Some(&search_path),
            Some(OsStr::new(".EXE")),
            &cwd,
        )
        .unwrap_err();
        assert!(error.contains("was not found"), "{error}");
    }
}

#[cfg(all(test, not(windows)))]
mod non_windows_tests {
    use std::ffi::{OsStr, OsString};

    use super::resolve_terminal_program;

    #[test]
    fn terminal_program_is_unchanged_off_windows() {
        assert_eq!(
            resolve_terminal_program(
                OsStr::new("tool-without-an-extension"),
                std::path::Path::new("/work"),
            )
            .unwrap(),
            OsString::from("tool-without-an-extension")
        );
    }
}
