# `.release/` — release scratch

This folder is used by CI for per-run scratch state. The currently-live D1
slot is now tracked by the **`SRUTHI_ACTIVE_D1_SLOT` GitHub Actions
repository variable** (values `A` or `B`), updated by the
`background-refresh` workflow after a successful deploy.

The previous file-based marker `active-slot.json` has been removed.

The workflow's per-run scratch dirs (`.release/work-*`) are gitignored.
