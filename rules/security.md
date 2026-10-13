---
description: Read before handling external input, SQL, shells, paths, output, authorization, or logging.
---

# Security

Treat external input as untrusted.
Use parameterized SQL.
Avoid shell interpolation; pass arguments separately.
Validate paths before file operations.
Encode output for its destination.
Authorize access to protected resources.
Never log secrets or personal information.
