# Day Timeline Drag Editing

Design: support reminder and actual-event moves plus visible-edge resizing, five-minute snapping, guild-time live feedback, two-hour context margins, clipped-edge arrows/no hidden handles, previous/next/today navigation and one-step Undo. Event moves change the recurring anchor; offset reminders follow, fixed day/clock anchors keep their specified clocks. A moved named-time reminder edge becomes an independent offset without changing the shared named time. Once markers move but do not resize. Apply on drop, preserving IDs/runtime; reject invalid/overlapping configurations atomically. Click without dragging keeps drill-down editing.

- [x] Add pure tested model edit functions for anchors, reminder edges and event anchor/duration across recurrence and DST.
- [x] Extend Day axis/context/navigation and clipped-end indicators; attach pointer/keyboard edits, live time feedback and Undo.
- [x] Verify bounds, rejected overlaps, recurrence/weekday/faction anchor preservation, signed offsets and browser pointer behavior. Document, review and publish PR.

Independent review found a multi-week weekday phase issue on cross-week moves. Unrepresentable moves are now rejected, with a passing regression and reviewer recheck. Once-within-window announcements are represented as true resizable eligibility windows; fixed once markers remain points.
