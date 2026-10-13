# SaleMaX mobile screen audit

## Scope and method

Initial read-only production review on 13 October 2026 at the mobile-width in-app browser viewport (about 430 CSS pixels). Screens were opened through the existing signed-in account and reviewed for visible layout, control alignment, and clipping. No customer records, messages, settings, or campaign actions were changed. The Inbox conversation pane was not opened because doing so can mark a conversation as read.

This is a continuing screen inventory, not a claim that every role-specific or Arabic screen has passed. Admin settings that expose credentials, QR pairing screens, browser permission prompts, and screens unavailable to this account still need a safe review plan.

## Screens reviewed

| Screen | Mobile observation | Status |
| --- | --- | --- |
| Business Dashboard | Summary cards stack cleanly; refresh and date-range controls remain visible. | Pass at reviewed viewport |
| Inbox | Chat list fits the phone width and the navigation opens as a drawer. Conversation pane not opened. | Partial review |
| Courses | Catalogue cards stack in one column; search and course actions remain within the viewport. | Pass at reviewed viewport |
| Candidate Applications | “Back to workspace” inherited a 180px flex basis when the mobile heading changed to a column. | Fix included: keep the button at a 44px minimum height |
| Lead Pipeline | Embedded screen reserved 260px for the closed desktop drawer, leaving only a narrow strip of the viewport for the board. | Fix included: make embedded workspaces full width on mobile |
| Lead Reports | Uses the same embedded workspace placement and showed the same narrow-strip issue. | Fix included with Lead Pipeline |
| Phonebook | Wide contact catalogue uses an internal horizontal scroll area; its scrollbar is visible and the page controls remain reachable. | Usable at reviewed viewport; horizontal table scroll required |
| Invoices & Payments | Search, course/date filters, and primary action stack vertically and fit the viewport. | Pass at reviewed viewport |
| Finance Reports | The tested URL still rendered the invoice register. Route behavior needs a separate functional audit. | Not assessed for report layout |
| Tasks | Header, owner filter, status filter, refresh and paging fit the viewport. | Pass at reviewed viewport |
| Team Access | Role editor, permissions and member sections stack in a single column. | Pass at reviewed viewport |
| WA Chatbot | Bot card and Add/Assign actions fit the viewport. | Pass at reviewed viewport |
| FAQs | Text and empty-state actions fit the viewport. | Pass at reviewed viewport |
| Automation Flows | Builder toolbar and canvas fit; small canvas nodes rely on the existing zoom controls. | Partial review |
| Campaign Dashboard | Summary cards use two columns without clipping. | Pass at reviewed viewport |
| Send Campaign | Template search, status selector, refresh and setup warning stack within the screen. No campaign was sent. | Pass at reviewed viewport |
| Create Meta Template | Wizard choices stack in one column and remain readable. Later steps not inspected. | Partial review |
| Admin Manage Plans | Plan cards stack and Edit/Delete actions span the card width. | Pass at reviewed viewport |
| Admin Manage Users | The data grid keeps its wide columns in an internal horizontal scroller; the scrollbar is visible and actions remain reachable. | Usable at reviewed viewport; horizontal table scroll required |

## Remaining inventory

Review the remaining screens exposed by each role, including settings, QR/Meta connection setup, campaign templates and later wizard steps, notification controls, agent views, and any optional sales modules. Repeat critical screens in Arabic/RTL and at narrower phone widths. Recheck the embedded Call Center, commission, sales finance, organization and task workspaces for role-specific content after the shared mobile-width fix.
