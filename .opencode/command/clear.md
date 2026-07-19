---
description: clear context — start a fresh session with no prior history
---

Inform the user of the following, exactly:

**To clear context and start fresh, use the built-in `/new` command.**

`/new` starts a new session with zero token history — this is the only way to fully reset context. The current session's history is saved and accessible via `/sessions` if you need it later.

This `/clear` command itself cannot wipe tokens because commands run inside the existing session. Use `/new` instead.
