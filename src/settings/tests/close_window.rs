use super::super::*;

#[test]
fn v12_defaults_close_window_behavior_to_ask() {
    let mut settings: Settings =
        serde_json::from_value(serde_json::json!({ "settings_version": 12 })).unwrap();

    assert_eq!(settings.close_window_behavior, CloseWindowBehavior::Ask);
    assert!(migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
}

#[test]
fn close_window_behavior_round_trips_and_invalid_values_fail_safe() {
    for (wire, expected) in [
        ("ask", CloseWindowBehavior::Ask),
        ("hide_to_tray", CloseWindowBehavior::HideToTray),
        ("quit", CloseWindowBehavior::Quit),
        ("unsupported", CloseWindowBehavior::Ask),
    ] {
        let settings: Settings = serde_json::from_value(serde_json::json!({
            "settings_version": CURRENT_SETTINGS_VERSION,
            "close_window_behavior": wire
        }))
        .unwrap();
        assert_eq!(settings.close_window_behavior, expected);

        let serialized = serde_json::to_value(settings).unwrap();
        let expected_wire = match expected {
            CloseWindowBehavior::Ask => "ask",
            CloseWindowBehavior::HideToTray => "hide_to_tray",
            CloseWindowBehavior::Quit => "quit",
        };
        assert_eq!(serialized["close_window_behavior"], expected_wire);
    }
}

#[test]
fn either_v13_client_shape_preserves_combined_v14_fields() {
    let existing = Settings {
        settings_version: CURRENT_SETTINGS_VERSION,
        close_window_behavior: CloseWindowBehavior::Quit,
        ime_keyboard_overlap_px: Some(72),
        ..Settings::default()
    };
    let mut incoming = Settings {
        settings_version: 13,
        close_window_behavior: CloseWindowBehavior::Ask,
        ime_keyboard_overlap_px: None,
        ..Settings::default()
    };

    preserve_current_settings_on_legacy_put(Some(13), &mut incoming, &existing);

    assert_eq!(incoming.close_window_behavior, CloseWindowBehavior::Quit);
    assert_eq!(incoming.ime_keyboard_overlap_px, Some(72));
}
