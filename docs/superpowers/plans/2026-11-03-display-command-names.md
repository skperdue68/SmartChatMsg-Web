# Display and slash-command names

Keep command.name as the sanitized slash identity and add optional command.displayName (1–80 characters). Existing IDs and runtime data remain unchanged. Old records fall back to their name. New entries generate a slash name until it is customized; invalid characters are removed before validation/save and the visible field is updated. Never truncate valid characters silently: retain 25-character, reserved-name and duplicate checks.

1. Add model/native helpers and tests for sanitization, display fallback and identity validation.
2. Web new-entry and main forms expose Display name and Slash-command name. Sidebar, heading, calendar and transfer review display the friendly name; matching still uses slash identity. Portable formats add optional displayName and retain backward reading.
3. Native planner and original settings expose both fields. Keep model.name as slash name for old callers/tests, track displayName in private drafts, preserve metadata across native exports using a separate optional COMMANDDISPLAY_V1 record, and merge by sanitized name. Friendly selection/status headings use the display fallback.
4. Test names with spaces/punctuation, custom fftg, screen normalization, reserved/colliding names, old files, planner saves, native/JSON transfer, and usage preservation. Run suites and publish separate PRs.
