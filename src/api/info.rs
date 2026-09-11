//! `GET /api/info` - what a client (or a hub probing this server) can learn
//! about it without authenticating to anything else.
//!
//! The payload lives here rather than in either handler because the two hosts
//! (`src/main.rs` and the Tauri embedded server) mount separate routers over
//! separate `AppState` types, but they have to answer identically. One shared
//! function is what stops the answers from drifting - which is how
//! `settings_version` came to be missing from both while the remote-server
//! probe that consumes it already expected it.

use crate::settings::CURRENT_SETTINGS_VERSION;

/// Build the `/api/info` payload.
///
/// `lan_ip` is the address to hand to another device on the same network;
/// `port` and `version` belong to the process answering.
///
/// `settings_version` is [`CURRENT_SETTINGS_VERSION`] - the schema version the
/// *binary* speaks - and deliberately not the stored `Settings::settings_version`.
/// A hub probes this endpoint to decide whether it can talk to the upstream, so
/// the answer has to describe what the upstream accepts, not how old its config
/// file happens to be (an upgraded binary can be sitting on a config it has not
/// migrated yet, and `load_settings` migrates it forward anyway).
///
/// The field is additive: consumers older than it ignore it, and a consumer
/// that needs it treats its absence as "this upstream is too old to say" rather
/// than as an error.
#[must_use]
pub fn info_payload(port: u16, version: &str, repo_url: &str) -> serde_json::Value {
    let lan_ip =
        local_ip_address::local_ip().map_or_else(|_| "127.0.0.1".to_string(), |ip| ip.to_string());
    serde_json::json!({
        "lan_ip": lan_ip,
        "port": port,
        "version": version,
        "repo_url": repo_url,
        "settings_version": CURRENT_SETTINGS_VERSION,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The remote-server probe reads exactly this key out of this payload, so a
    /// rename here would silently turn every probe's version check into
    /// `None` - the failure mode that motivated exposing it at all.
    #[test]
    fn payload_carries_the_settings_version_the_probe_reads() {
        let payload = info_payload(58911, "0.26.0", "https://example.invalid/repo");

        assert_eq!(payload["settings_version"], serde_json::json!(CURRENT_SETTINGS_VERSION));
        // The pre-existing fields must not be disturbed by the addition.
        assert_eq!(payload["port"], serde_json::json!(58911));
        assert_eq!(payload["version"], serde_json::json!("0.26.0"));
        assert_eq!(payload["repo_url"], serde_json::json!("https://example.invalid/repo"));
        assert!(payload["lan_ip"].is_string(), "lan_ip must still be reported: {payload}");
    }
}
