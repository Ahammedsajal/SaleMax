# WhatsApp Inbox media retention

The existing app startup runs media cleanup 60 seconds after startup and every 15 minutes thereafter. Group media expires after **48 hours**, and individual WhatsApp chat media after **28 days**. Age uses the latest of the message timestamp, database arrival time and local file modification time. A file referenced by multiple conversations uses the longest remaining window. Backlogged work is bounded to 500 files / 512 MiB per sweep.

Only local Inbox media bytes are removed. Message text, captions, conversations, group metadata, contacts and leads are preserved. The previous 30-day whole-conversation purge is replaced, not run alongside this job. Expired media displays an English/Arabic expiry notice in the existing conversation renderer; the group shared-media panel omits expired items.

The job discovers persisted file references in other database records, including campaigns, templates, bots, scheduled payloads, catalogues and avatars, and protects those shared assets. Unreferenced files in the downloaded `meta-media` directory expire after 28 days. Unreferenced files in the shared `media` asset library are retained because their ownership cannot safely be inferred. External URLs, nested asset directories, symlinks and files with unknown message age are not deleted. Invalid legacy history or incomplete reference scans abort cleanup before deletion. A global database advisory lock prevents overlapping sweeps, and freshly referenced or changed files are rechecked before unlinking.

No schema migration is required. The scan is paginated and capped at 100,000 matching media/reference rows and 100,000 files; a limit failure is logged and deletes nothing. Review `[retention] WhatsApp media cleanup` logs for failures, protected/deferred counts and deleted bytes. A larger deployment reaching those limits should adopt an indexed media ownership registry before raising the bounds. File paths and customer content are not logged.

Operator commands inside the deployed app:

```bash
node scripts/whatsapp-media-retention.cjs --dry-run
node scripts/whatsapp-media-retention.cjs --apply
```

`--dry-run` reads references and reports aggregate eligibility without changing files or data. `--apply` permanently removes eligible local files. No new backup copy of expired media is made; reverting code cannot restore deleted bytes. Existing independent backup policies are unaffected. This cleanup changes server storage, not media already downloaded to WhatsApp handsets.
