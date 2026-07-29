use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Direction for `MissionControlOp::Navigate`.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NavDir {
    Up,
    Down,
    Left,
    Right,
}

/// Operations the hardware keyboard (or any sync client) can request against
/// the shared Mission Control state. Tagged so the wire format mirrors the
/// frontend discriminated union.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum McOp {
    Toggle,
    Navigate {
        dir: NavDir,
    },
    Confirm,
    Cancel,
    /// Jump directly to a workspace (used by mouse-driven workspace selection
    /// in the overview). Allows one round-trip instead of repeated Navigate.
    Jump {
        workspace_id: Option<String>,
    },
}

/// Global MC snapshot. `open` is the on/off bit; `selected_*` describe the
/// highlighted card inside the overview. `selected_workspace_id == None`
/// means the default workspace (`__default__`).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct MissionControlSnapshot {
    pub open: bool,
    pub selected_workspace_id: Option<String>,
    pub selected_tab_id: Option<String>,
}

/// Shared MC state - mirrors the `WorkspacesState = Arc<RwLock<...>>` pattern.
pub type MissionControlState = Arc<RwLock<MissionControlSnapshot>>;

#[must_use]
pub fn create_mission_control_state() -> MissionControlState {
    Arc::new(RwLock::new(MissionControlSnapshot::default()))
}
