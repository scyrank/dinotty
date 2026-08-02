# Dinotty portable-pty patch

This directory vendors `portable-pty` 0.9.0 under its upstream MIT license.

Dinotty's Windows server and Tauri desktop process can run without a parent
console. Upstream 0.9.0 unconditionally enables
`PSEUDOCONSOLE_INHERIT_CURSOR`; in that headless configuration it prevents
reliable ConPTY input and child-exit observation. The local patch omits only
that flag and retains `PSEUDOCONSOLE_RESIZE_QUIRK` and
`PSEUDOCONSOLE_WIN32_INPUT_MODE`.

`tests/terminal_exit_regression.rs` is the regression gate for this patch.
When updating the vendored crate, reapply or retire the patch only after that
test passes in a detached Windows process.
