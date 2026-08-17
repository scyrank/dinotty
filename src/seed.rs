//! Bundled seed plugins shipped inside the server binary (keyboard-plugin-design.md, Phase 1b).
//!
//! The app carries the builtin mobile keyboard as a plugin: the packed archive
//! lives at `seed/builtin-keyboard.tar.gz` (repository root) and is embedded at
//! compile time, so every deployment (dev server, cargo deb, Tauri desktop)
//! seeds the plugin without extra packaging or path resolution. On startup
//! `PluginManager::ensure_seed` installs it when missing and updates it when the
//! installed copy is older; afterwards the normal plugin update channel owns it.
//!
//! `seed/` must exist at build time (committed with `.gitkeep`); the archive
//! itself is a build artifact (see `scripts/pack-seed.sh`) and gitignored, so a
//! dev checkout without the archive simply skips seeding.

use rust_embed::Embed;

#[derive(Embed)]
#[folder = "seed/"]
pub struct SeedAssets;
