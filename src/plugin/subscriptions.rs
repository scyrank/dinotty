#![allow(clippy::missing_errors_doc)]
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;

use super::PluginManagerState;

/// In-memory registry of plugin-to-event subscriptions. The frontend calls
/// `POST /api/plugins/:id/events/subscribe` whenever a plugin's `ctx.events.subscribe`
/// is invoked, and `unsubscribe` when the last handler for that event is removed.
/// The registry powers two things:
///
/// 1. `GET /api/plugins/events/has-subscriber?event=...` - lets the settings UI
///    decide whether to offer `verification_code` login (requires a notifier).
/// 2. `delete_plugin` 409 guard - refuses to uninstall a plugin that currently
///    subscribes to `auth.verification_code` while `login_method=verification_code`,
///    since doing so would lock the user out of remote login.
///
/// The registry is best-effort: if a plugin process dies without unsubscribing
/// (e.g. crash), stale entries may linger until the next `unsubscribe_all` on
/// reinstall. The 409 guard errs on the side of caution - a false positive just
/// means the user has to switch `login_method` before uninstalling.
#[derive(Clone, Default)]
pub struct SubscriptionRegistry {
    // plugin_id -> set of event names
    inner: Arc<DashMap<String, HashSet<String>>>,
}

#[derive(Debug, Deserialize)]
pub struct SubscribeBody {
    pub event_name: String,
}

#[derive(Debug, Deserialize)]
pub struct HasSubscriberQuery {
    pub event: String,
}

#[derive(Debug, Serialize)]
pub struct HasSubscriberResponse {
    pub has_subscriber: bool,
}

impl SubscriptionRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that `plugin_id` is subscribed to `event_name`. Idempotent.
    pub fn subscribe(&self, plugin_id: &str, event_name: &str) {
        let mut entry = self.inner.entry(plugin_id.to_string()).or_default();
        entry.insert(event_name.to_string());
    }

    /// Remove a single subscription. Idempotent.
    pub fn unsubscribe(&self, plugin_id: &str, event_name: &str) {
        if let Some(mut entry) = self.inner.get_mut(plugin_id) {
            entry.remove(event_name);
            if entry.is_empty() {
                drop(entry);
                self.inner.remove(plugin_id);
            }
        }
    }

    /// Remove all subscriptions for `plugin_id`. Called when the plugin is
    /// uninstalled so the registry doesn't leak entries.
    pub fn unsubscribe_all(&self, plugin_id: &str) {
        self.inner.remove(plugin_id);
    }

    /// True if any plugin subscribes to `event_name`.
    #[must_use]
    pub fn has_subscriber(&self, event_name: &str) -> bool {
        self.inner.iter().any(|entry| entry.value().contains(event_name))
    }

    /// True if `plugin_id` specifically subscribes to `event_name`. Used by
    /// the uninstall guard to refuse removing a critical notifier plugin.
    #[must_use]
    pub fn has_subscriber_in(&self, plugin_id: &str, event_name: &str) -> bool {
        self.inner.get(plugin_id).is_some_and(|entry| entry.value().contains(event_name))
    }
}

pub async fn subscribe(
    Path(plugin_id): Path<String>,
    State(registry): State<SubscriptionRegistry>,
    Json(body): Json<SubscribeBody>,
) -> impl IntoResponse {
    if body.event_name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "event_name required"})),
        );
    }
    registry.subscribe(&plugin_id, &body.event_name);
    (StatusCode::OK, Json(serde_json::json!({"ok": true})))
}

pub async fn unsubscribe(
    Path(plugin_id): Path<String>,
    State(registry): State<SubscriptionRegistry>,
    Json(body): Json<SubscribeBody>,
) -> impl IntoResponse {
    registry.unsubscribe(&plugin_id, &body.event_name);
    (StatusCode::OK, Json(serde_json::json!({"ok": true})))
}

pub async fn has_subscriber(
    State((plugins, registry)): State<(PluginManagerState, SubscriptionRegistry)>,
    Query(query): Query<HasSubscriberQuery>,
) -> impl IntoResponse {
    // Runtime subscriptions (plugin activated and called ctx.events.subscribe)
    if registry.has_subscriber(&query.event) {
        return Json(HasSubscriberResponse { has_subscriber: true });
    }
    // Manifest-declared subscriptions (plugin installed but not activated yet)
    let has = plugins.list().iter().any(|info| {
        info.manifest
            .events
            .as_deref()
            .is_some_and(|events| events.iter().any(|e| e == &query.event))
    });
    Json(HasSubscriberResponse { has_subscriber: has })
}

#[cfg(test)]
mod tests {
    use super::SubscriptionRegistry;

    fn reg() -> SubscriptionRegistry {
        SubscriptionRegistry::new()
    }

    #[test]
    fn subscribe_and_query() {
        let r = reg();
        assert!(!r.has_subscriber("auth.verification_code"));
        r.subscribe("feishu-notify", "auth.verification_code");
        assert!(r.has_subscriber("auth.verification_code"));
        assert!(r.has_subscriber_in("feishu-notify", "auth.verification_code"));
        assert!(!r.has_subscriber_in("other-plugin", "auth.verification_code"));
        assert!(!r.has_subscriber("command_finished"));
    }

    #[test]
    fn subscribe_is_idempotent() {
        let r = reg();
        r.subscribe("p1", "e1");
        r.subscribe("p1", "e1");
        r.subscribe("p1", "e1");
        assert!(r.has_subscriber_in("p1", "e1"));
        r.unsubscribe("p1", "e1");
        assert!(!r.has_subscriber_in("p1", "e1"));
        // Entry should be removed when the last event is unsubscribed.
        assert!(!r.inner.contains_key("p1"));
    }

    #[test]
    fn unsubscribe_removes_single_event_only() {
        let r = reg();
        r.subscribe("p1", "e1");
        r.subscribe("p1", "e2");
        r.unsubscribe("p1", "e1");
        assert!(!r.has_subscriber_in("p1", "e1"));
        assert!(r.has_subscriber_in("p1", "e2"));
        assert!(r.inner.contains_key("p1"));
    }

    #[test]
    fn unsubscribe_all_clears_plugin() {
        let r = reg();
        r.subscribe("p1", "e1");
        r.subscribe("p1", "e2");
        r.subscribe("p1", "e3");
        r.unsubscribe_all("p1");
        assert!(!r.has_subscriber_in("p1", "e1"));
        assert!(!r.has_subscriber_in("p1", "e2"));
        assert!(!r.has_subscriber("e1"));
        assert!(!r.inner.contains_key("p1"));
    }

    #[test]
    fn unsubscribe_nonexistent_is_noop() {
        let r = reg();
        r.unsubscribe("nonexistent", "e1");
        r.unsubscribe_all("nonexistent");
        assert!(!r.has_subscriber("e1"));
    }

    #[test]
    fn has_subscriber_aggregates_across_plugins() {
        let r = reg();
        r.subscribe("p1", "auth.verification_code");
        r.subscribe("p2", "auth.verification_code");
        assert!(r.has_subscriber("auth.verification_code"));
        r.unsubscribe("p1", "auth.verification_code");
        assert!(r.has_subscriber("auth.verification_code"));
        r.unsubscribe("p2", "auth.verification_code");
        assert!(!r.has_subscriber("auth.verification_code"));
    }
}
