---
description: Block dd with /dev/ targets — disk overwrite is irreversible.
condition:
  - '\bdd\s[^|;&\n]*\bof=/dev/'
  - '\bdd\s[^|;&\n]*\bif=/dev/'
scope: tool:bash
---

# No dd with disk targets

You were about to run `dd` with a `/dev/` source or destination. Stop.

`dd of=/dev/...` overwrites raw disk contents — including the boot sector, partition table, or another volume's filesystem if the device name is off by one. There is no undo. `dd if=/dev/...` reads from raw devices, which can dump disk encryption keys, swap contents, or other volumes' data into the conversation transcript.

Right approach:

- Tell the user the exact `dd` command you'd run and what disk it targets
- Wait for them to execute it themselves, after they've double-checked the device name with `diskutil list` (macOS) or `lsblk` (Linux)
- For file-level copies, use `cp`, `rsync`, or the `Write` tool — none touch raw devices
- For creating a bootable image, hand the user the command and let them confirm

Re-plan as a hand-off to the user, then proceed.
