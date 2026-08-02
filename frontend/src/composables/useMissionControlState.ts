import { reactive } from 'vue'
import type { McOp } from '../types/protocol'

/// Global Mission Control state mirror. The backend is the single source of
/// truth; this reactive object is updated from `mission_control_toggled` /
/// `selection_changed` / `mc_snapshot` sync messages. All MC UI components
/// subscribe to this instead of holding their own local refs, so multi-
/// client changes (hardware keyboard, other tabs, other devices) propagate
/// automatically.
///
/// Singleton: the same object is shared across every component that imports
/// it - same pattern as the `useWorkspaces` global state.
export interface MissionControlState {
  open: boolean
  /// `null` means the default workspace (`__default__`).
  selectedWorkspaceId: string | null
  selectedTabId: string | null
  /// Tab title looked up by the server when selected_tab_id changed, so
  /// touchscreen clients can render the name without a tab_list round-trip.
  selectedTabTitle: string | null
}

const mcState = reactive<MissionControlState>({
  open: false,
  selectedWorkspaceId: null,
  selectedTabId: null,
  selectedTabTitle: null,
})

/// Sender registry. App.vue calls `setMcSender(syncWs.sendSync)` once the
/// sync WS is created; components call `sendMcOp(op)` without needing the
/// WS passed in as a prop.
type McSender = (op: McOp) => void
let mcSender: McSender = () => {
  // No-op until App.vue wires the real sender. Logged at debug to avoid
  // noise in tests / Storybook-style isolated mounts.
  if (typeof console !== 'undefined') {
    console.debug('[mc] sender not registered yet, dropping op')
  }
}

export function setMcSender(sender: McSender): void {
  mcSender = sender
}

export function sendMcOp(op: McOp): void {
  mcSender(op)
}

export function useMissionControlState() {
  return mcState
}
