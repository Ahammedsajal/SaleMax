# SaleMaX mobile screen audit

## Scope and method

Initial read-only production review on 13 October 2026 at the mobile-width in-app browser viewport (about 430 CSS pixels). Screens were opened through the existing signed-in account and reviewed for visible layout, control alignment, and clipping. No customer records, messages, settings, or campaign actions were changed. The Inbox conversation pane was not opened because doing so can mark a conversation as read.

This is a continuing screen inventory, not a claim that every role-specific or Arabic screen has passed. Screens were reviewed in English at about 430 CSS pixels, with Lead Reports also checked in Arabic/RTL. Narrower widths and the remaining administrative sections still need review.

## Screens reviewed

| Screen | Mobile observation | Status |
| --- | --- | --- |
| Business Dashboard | Summary cards stack cleanly; refresh and date-range controls remain visible. | Pass at reviewed viewport |
| Inbox | Chat list fits the phone width and the navigation opens as a drawer. Conversation pane not opened. | Partial review |
| Courses | Catalogue cards stack in one column; search and course actions remain within the viewport. | Pass at reviewed viewport |
| Candidate Applications | “Back to workspace” inherited a 180px flex basis when the mobile heading changed to a column. | Fixed and production-verified: full-width button with a 44px minimum height |
| Lead Pipeline | Embedded screen reserved 260px for the closed desktop drawer, leaving only a narrow strip of the viewport for the board. | Fixed and production-verified: full-width workspace and no background-page scrollbar |
| Lead Reports | Uses the same embedded workspace placement and showed the same narrow-strip issue. | Fixed and production-verified in English and Arabic/RTL |
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
| Admin Add Plan | Fields stack vertically; Back and Save remain side by side at the bottom. | Pass at reviewed viewport; form closed without saving |
| Admin Manage Users | The data grid keeps its wide columns in an internal horizontal scroller; the scrollbar is visible and actions remain reachable. | Usable at reviewed viewport; horizontal table scroll required |
| Admin Add User | Modal stays inside the viewport and its footer buttons remain reachable after scrolling the form. | Pass at reviewed viewport; form closed without creating an account |
| Agent List / Add Agent | Agent grid has an internal horizontal scroller; the add form fields stack vertically. | Pass at reviewed viewport; form closed without saving |
| Business navigation drawer | Search and close controls are visible; the grouped menu scrolls vertically inside the drawer. | Pass at reviewed viewport |

## Remaining inventory

Review the remaining screens exposed by each role, including other admin pages, QR/Meta connection setup, later template steps, notification controls, and optional sales modules. Credential/pairing screens and the notification permission control were not opened during this pass. Repeat critical screens at narrower phone widths. The Finance Reports menu currently lands on the invoice register at `section=reports`; its separate report layout was therefore unavailable for this mobile review. The shared embedded-workspace fix also covers Call Center, commission, sales finance, organization and task frames; only Lead Pipeline/Reports and Tasks were visually reviewed.
