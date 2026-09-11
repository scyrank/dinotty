//! Shared helpers for integration tests that spawn an isolated `dinotty-server`.
#![allow(clippy::unwrap_used, clippy::expect_used)]
//!
//! `DINOTTY_CONFIG_SUFFIX` keeps each child off the user's real config, but the
//! server still writes `%APPDATA%\dinotty{suffix}` and `%USERPROFILE%\.dinotty{suffix}`.
//! Dropping `ServerGuard` kills the child and removes those throwaway directories.

use std::path::{Path, PathBuf};
use std::process::Child;
use std::time::Duration;

pub struct ServerGuard {
    child: Child,
    suffix: String,
}

impl ServerGuard {
    pub fn new(child: Child, suffix: impl Into<String>) -> Self {
        Self { child, suffix: suffix.into() }
    }
}

impl Drop for ServerGuard {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        remove_throwaway_instance_dirs(&self.suffix);
    }
}

fn is_safe_test_suffix(suffix: &str) -> bool {
    suffix.starts_with('-')
        && suffix.contains("-test-")
        && !suffix.contains(['/', '\\'])
        && !suffix.contains("..")
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

fn config_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("XDG_CONFIG_HOME").filter(|dir| !dir.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
    #[cfg(target_os = "macos")]
    {
        home_dir().map(|home| home.join("Library").join("Application Support"))
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        home_dir().map(|home| home.join(".config"))
    }
}

fn remove_dir_best_effort(path: &Path) {
    if !path.exists() {
        return;
    }
    for _ in 0..10 {
        if std::fs::remove_dir_all(path).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = std::fs::remove_dir_all(path);
}

fn remove_named_dir(parent: &Path, name: &str) {
    let path = parent.join(name);
    if path.file_name().and_then(|file_name| file_name.to_str()) != Some(name) {
        return;
    }
    remove_dir_best_effort(&path);
}

pub fn remove_throwaway_instance_dirs(suffix: &str) {
    if !is_safe_test_suffix(suffix) {
        return;
    }
    if let Some(home) = home_dir() {
        remove_named_dir(&home, &format!(".dinotty{suffix}"));
    }
    if let Some(config) = config_dir() {
        remove_named_dir(&config, &format!("dinotty{suffix}"));
    }
}

#[cfg(test)]
mod tests {
    use super::{is_safe_test_suffix, remove_throwaway_instance_dirs};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn only_test_suffixes_are_safe_to_delete() {
        assert!(is_safe_test_suffix("-mcp-stdio-test-123-0"));
        assert!(is_safe_test_suffix("-scope-test-1-0"));
        assert!(is_safe_test_suffix("-vc-test-9-2"));
        assert!(!is_safe_test_suffix(""));
        assert!(!is_safe_test_suffix("prod"));
        assert!(!is_safe_test_suffix("-plugin-manager-wiring-test"));
        assert!(!is_safe_test_suffix("-test/../.dinotty"));
        assert!(!is_safe_test_suffix(r"-test\..\AppData"));
    }

    #[test]
    fn drop_removes_throwaway_home_and_config_directories() {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos();
        let suffix = format!("-mcp-stdio-test-cleanup-{stamp}-0");
        let home = super::home_dir().expect("home directory");
        let config = super::config_dir().expect("config directory");
        let plugin_root = home.join(format!(".dinotty{suffix}"));
        let config_root = config.join(format!("dinotty{suffix}"));

        fs::create_dir_all(plugin_root.join("plugins")).expect("create plugin dir");
        fs::create_dir_all(config_root.join("settings")).expect("create config dir");
        assert!(plugin_root.is_dir());
        assert!(config_root.is_dir());

        remove_throwaway_instance_dirs(&suffix);

        assert!(!plugin_root.exists(), "{}", plugin_root.display());
        assert!(!config_root.exists(), "{}", config_root.display());
    }
}
