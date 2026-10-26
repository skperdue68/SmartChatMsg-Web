# Shared Server Library

Approved design: full Lua configurations are publicly shared without logins. Friendly names must be unique (trimmed NFC, case-insensitive); overwrites and deletion are not exposed. Save uses the same current/latest merge and validation as downloading. Load lists names/dates and opens a selected copy after unsaved-edit confirmation. No automatic writes to ESO or automatic upload of opened files.

- [x] Server/store: GET list, POST create, GET/HEAD Lua by opaque ID; bounded JSON/Lua, restricted parser, existing host/origin controls and strict same-origin JSON POST. Atomic exclusive publication and restart persistence. LIBRARY_DIR default data/shared-library, ignored by git.
- [x] Client: prominent Library and Save to server controls, public/full-file disclosure, name/list/load/save/refresh/error handling, shared workspace installation and export pipeline.
- [x] Tests: temporary real storage, simultaneous duplicate names, restart/list/load, validation/path/origin rejection; browser save/list/load/duplicate, dirty cancel and latest-runtime merge.
- [x] Document storage/backups/deployment, independently review, run Node/browser CI and publish PR.

Verification: all 70 Node tests and the full browser suite passed, including real HTTP save/load, unique-name races, persistence, runtime merge, and cancellation of stale asynchronous loads. Independent review confirmed the save/load race fixes.
