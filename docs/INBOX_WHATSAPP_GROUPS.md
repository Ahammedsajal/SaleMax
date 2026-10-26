# QR WhatsApp groups in the existing Inbox

Group conversations use the existing Inbox, QR instances, conversation tables,
and authenticated workspace API. They are identified by a hash of owner UID,
QR instance ID and complete `@g.us` JID. Group JIDs are never treated as phone numbers.

`/api/workspace/inbox/groups` uses the shared feature session. Compatibility
aliases `/api/inbox/groups` and `/api/agent/inbox/groups` mount the same router.
Read/reply permissions and assigned conversation/shared QR scope are enforced
on every request. Directory sync is limited to accessible QR instances.

The Inbox's Chats / Groups switch uses the existing native chat list, message
renderer, composer, QR number filters, search and unread controls. The group
subject is passed through a display-only legacy name adapter; it never creates
a Phonebook row. A tailored native Info sidebar replaces customer-only controls
with group description, read-only members/admin roles and shared media/files.
The Inbox's group mode provides a directory per QR number,
read-only member names/available numbers/admin roles, message sender attribution,
media browsing, text replies, quoted replies, member mentions and attachments
(images, video, audio and supported documents, up to 16 MB). The dedicated
group APIs also provide a bounded authenticated attachment endpoint. The native
composer uses the existing group-aware QR transport. Synced group metadata is excluded from the direct
chat list so group JIDs do not appear as customer phone numbers. WhatsApp enforces
membership; admin-only groups are checked again before sending.

Group message ingestion skips lead capture, automatic Phonebook contacts and
opening rules, CRM lead forwarding, configured bots, legacy flows, generic
automations and lead attendance. Group members are not automatically contacts.
Group history is retained only as Inbox conversation data. Profile/member data
are scoped by owner and QR instance and refreshed on group metadata events.

Group history starts from provider events received after support is enabled.
Directory sync fetches membership metadata; it does not promise WhatsApp's full
historical message archive. Unsupported message kinds receive a visible fallback.
Member management, invitations, joining/leaving, native polls and community
administration remain in WhatsApp. No group sends are performed for deployment
acceptance without a designated test group.
