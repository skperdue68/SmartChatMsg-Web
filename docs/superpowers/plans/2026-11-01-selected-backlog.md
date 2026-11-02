# Selected backlog implementation plan

Approved November1: items1,2,3,4,5,6,10,11 only. No password-required loading, default-format migration or message-lock work.

- [x] Verify Next Event Occurrence wording, update footer SmartChatMsg3.02+.
- [x] Week/month navigation preserving overview filters and civil calendar boundaries.
- [x] Server library categories and alphabetical sorting; remove library export downloads.
- [x] Import button wording and spacing.
- [x] Confirmed deletion of either server record type; protected deletion authenticates with the existing salted hash and shares password throttling with overwrites; validate Origin/JSON, serialize with saves, release quotas.
- [x] Optional percommandguild shareGuildOfficerCooldowns=false in native/web settings and all transfers; same guild matching only, own outgoing channel unchanged, Zone/Group unaffected.
- [x] Update documentation and targeted/full Node, browser, Lua tests.
- [x] Push separate web and native PRs; update persisted future-work list with completed links.
