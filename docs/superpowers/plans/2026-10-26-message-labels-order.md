# Message Labels and Display Order

Scope: optional message.name plus positive displayOrder metadata. Web names are limited to 60 characters, defaults use Message N. Mouse drag/keyboard arrow reordering is scoped to the current command+guild and affects display only. Preserve IDs, text, message pool references, usage, locks, expanded cards and unsaved text drafts. Include metadata in full Lua/latest-runtime merges and portable event sharing. The matching addon preserves metadata on startup and in backward-compatible optional MESSAGE export columns; no new in-game naming UI is required.

- [x] Add pure ordering/default-name helpers and preservation tests.
- [x] Add library drag handles, live name editing, pool labels, draft/scroll preservation and browser coverage.
- [x] Add portable metadata validation/export/import, preserving private locked metadata.
- [x] Extend addon metadata persistence and full text import/export with legacy-record tests.
- [x] Audit runtime compatibility. Fix future DST-gap row isolation in addon, and align web monthly ordinal recurrence and unsupported greeting token previews.
- [x] Independent review and model/Lua comparison. Six fresh timing cases agree; addon suite includes metadata and future-DST regressions.
