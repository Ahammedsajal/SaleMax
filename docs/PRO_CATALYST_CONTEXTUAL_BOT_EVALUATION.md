# Pro Catalyst contextual chatbot: candidate evaluation

Status: development candidate; the new `contextualAiPilot` setting is not enabled in production. The tests below do not establish production readiness or customer-reply quality across all conversations.

The candidate asks the configured AI provider to propose an action and reply from a bounded conversation history, the selected course, pending contact questions, and current approved business facts. Server code validates proposed sources and prices, preserves manual or claimed handoffs, and retains control of sends and state changes. It suppresses legacy intake prompts after a contextual AI reply. A pending, unclaimed callback can be resumed without cancelling its staff task. The candidate is restricted to QR phone identities that match both the test and allowed recipient lists; unresolved WhatsApp LIDs do not qualify.

## Evidence so far

- A seven-day, 50-conversation sample was replayed through the interpreter with customer sends disabled. In the last run, automated checks accepted 36 proposals and rejected 14. A rejection means the draft failed a guard, not that the entire live flow was tested or that an accepted response was useful. It is not a relevance score. Reasons included unknown or missing sources, unsupported numbers or certificates, and requests requiring server-owned staff actions.
- In isolated previews using live course facts and synthetic messages, the candidate gave a polite acknowledgement after course details and a defer response to “Not now.” It returned the published MS Office price and kept that course as context for a question about weekly classes. A deliberate change to Marine Deckhand used its course facts. No customer message was sent in these previews.
- A synthetic database transaction exercised pending-callback, manual-pause, and claimed-handoff conditions and was rolled back. Real handset takeover and the complete WhatsApp receive-to-send path for this candidate have not been verified.
- A prompt-cache experiment on synthetic requests produced provider-reported cached input tokens on repeated stable prefixes. Cache hits and savings depend on provider behavior and input size.

## Remaining release gates

1. Review a redacted held-out replay for relevance and accuracy, including course switches, mixed intents, replies to callbacks, refusals, fragmented messages, and Arabic. Investigate rejected proposals and verify fallback quality; do not treat validation acceptance as answer quality.
2. Run integration tests against a disposable database and a mocked WhatsApp channel, including the full inbound handler, verified pilot audience, handoff ownership, customer-message races, and duplicate delivery behavior.
3. Verify real manager-phone text and voice-note takeover and the pilot channel end to end. Confirm that callbacks remain actionable and that customers are not promised a call before a request is actually recorded.
4. Enable only the approved test audience after the agreed quality target is met; record the release, monitoring and rollback evidence in `DEPLOYMENT.md`. General rollout requires a separate explicit decision and production evidence.
