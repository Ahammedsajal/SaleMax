# Sidebar startup session sharing

The shared browser client must keep one in-flight session request per actor and credential identity. A five-second reuse period starts after a successful response. A pending request must not expire because of elapsed wall time: repeated module calls otherwise supersede the pending promise, and earlier consumers wait again for the newer generation. Explicit invalidation and identity switches still require a fresh request; errors remain retryable.

Read-only cookie requests go directly to the authenticated feature endpoint. That endpoint verifies the business session itself. Mutations and direct callers of `headers()` still obtain a current CSRF token. No permission or server authentication check is removed.

Run `node --test tests/workspace-api-client.test.js`. Coverage includes a 14-second pending request, completed-cache expiry, identity switching, explicit permission invalidation during a request, failed-request retry, denied access, and cookie write CSRF.

## Production overlay

Inspect actual container mounts before building or activating. The production shell can be a bind-mounted file that overrides image HTML. Preserve that exact running shell, patch only its workspace client cache reference with `deploy/patch-sidebar-startup.cjs`, and install the release copy with mode `0644` before app recreation. The sidebar-startup Compose override deliberately changes the `/app/client/public/index.html` source to this reviewed release copy. Preserve all other mount destinations and sources and the ordered existing Compose chain.

The Docker overlay updates the shared client on the exact running image. The image shell patch alone is insufficient when a shell mount is present. Compare the served `/user` script version, runtime client hash, and browser DOM version after release. Keep HTML rendering changes made by tenant branding separate from the underlying shell hash. No schema migration or stored permission cache is introduced.
