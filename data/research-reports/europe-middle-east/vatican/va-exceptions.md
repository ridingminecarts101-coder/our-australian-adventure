# VA exceptions and migration notes

The current registry has no `VA` code, so canonical schema lint will reject this separate file until the registry/map work lands. The canonical lead owns that change.

Six Vatican experiences already exist under `IT` with frozen IDs 831 and 889–893: Vatican Museums, St Peter’s Basilica, St Peter’s Square, Vatican Necropolis, Vatican Gardens and Papal Audience. None is duplicated here. In particular, the Via Triumphalis cemetery is a separate Roman burial area from the existing St Peter’s Scavi/Necropolis row.

Three rows are sufficient for this small-state starter. Castel Gandolfo was excluded because it is an extraterritorial property in Italy; museum-room microtasks, dome climbing, Gardens variants and audience/Angelus variants were excluded as token subactivities of existing rows. A later migration must preserve the six frozen IDs and explicitly decide whether they remain aliased under IT or move to VA; never create parallel copies carrying new IDs.

The Teutonic Cemetery’s morning access rule was read directly from the Holy See page on 2026-09-11. It is mutable and the row therefore tells users to follow the gate procedure and notes the Wednesday exception rather than promising entry.
