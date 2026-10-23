---
type: llm
focus: trace
weight: 1
---

katana_list_patches (or a katana_write call that is refused) happens before any katana_write call that passes overwrite: true.
