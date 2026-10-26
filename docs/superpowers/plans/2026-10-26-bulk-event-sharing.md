# Bulk Event Sharing Implementation Plan

Use superpowers:executing-plans to implement inline.

- [x] Extend portable.js with a versioned multi-event bundle; include timeline and on-demand/startup command settings, output channels and unlocked messages; exclude runtime and private content. Keep old single-timeline files readable.
- [x] Build atomic import staging against the selected destination account. Resolve guild by normalized name, command by normalized name, reuse matching IDs/messages and local usage, create missing commands, preserve locked messages and runtime. Reject ambiguous matches, invalid timing and timezone mismatches; show skipped missing guilds.
- [x] Put selectable export/import panels first in Import / Export. Scope export to the selected account/guild with Select all and Clear. Review imported records before applying selected records. Keep legacy conversion and old single-timeline tools in a collapsed Advanced section.
- [x] Add tests proving bundle privacy, cross-account/guild-slot mapping, repeated import deduplication, matching names with different IDs, partial selection, runtime/lock preservation and browser review flow. Run Node and browser suites, document and push to current PR.

Rulings: sharing does not include account-wide defaults; the full Lua download retains these. Import adds/updates selected events and does not delete unselected events. Existing local messages not selected into the new pools are retained. Missing guilds are skipped because the browser cannot query live ESO guild membership. Legacy scheduled items must be converted before portable sharing; full Lua download remains available for backup.

Review: independent reviewer found multi-guild new-command duplication and legacy slot-only message matching gaps. Both corrected with dedicated regressions; reviewer verified both fixes and all eight sharing tests. Final full suite and browser checks are recorded in PR validation.
