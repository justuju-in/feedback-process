# Formbricks integration

This branch connects the existing feedback lifecycle to a real Formbricks link
survey. Formbricks supplies its survey builder and respondent interface. The
feedback app imports verified completed responses and continues to handle
requests, due dates, reminders, acknowledgement, discussion, and follow-ups.
It does not reimplement the entire Formbricks product or unlock paid features.

## Local testing with the same normal login as the Form.io branch

Run `npm run test:local` from the repository root, then open
http://localhost:3117/login. Use the ordinary email/password fields:

| Local account | Email | Local password |
| --- | --- | --- |
| Rani Singh | rani@justuju.in | RaniLocal!2026 |
| Pooja (test) | pooja@test.example | TestFeedback!123 |
| Shanti (test) | shanti@test.example | TestFeedback!123 |

These are the earlier Form.io local test identities. All three have normal
member access. There are no admin/giver login buttons, no public credentials
endpoint, and no authentication bypass. Log out and sign in as another person
to test sending and receiving feedback. These passwords apply only to this
isolated local database, not staging or production.

The launcher requires installed frontend/backend dependencies and MySQL 8's
`mysqld` executable. It starts its own loopback-only MySQL (3317), backend
(5117), and frontend (3117). Data is stored under
`/tmp/feedback-process-local-test-<uid>` on Linux and reused until removed by
system temporary-file cleanup. The database is `feedback_process_local_test`.
No production credentials or email/webhook configuration is loaded. Ctrl+C
stops all services. If a port is occupied, the launcher stops instead of
connecting to another server.

For actual external Formbricks surveys, export FORMBRICKS_URL and
FORMBRICKS_API_KEY in the launching terminal before starting. Without them,
normal login and native feedback testing work; connecting external surveys
still requires the workspace configuration described below.

## Configure staging

Set these variables on the **backend**, never in NEXT_PUBLIC variables:

```env
FORMBRICKS_URL=https://app.formbricks.com
FORMBRICKS_API_KEY=<workspace-scoped management API key with read/write access>
```

For an existing self-hosted instance, replace FORMBRICKS_URL with its HTTPS
origin. HTTP is supported only for localhost development. This branch does not
install or operate a self-hosted Formbricks server. Use a dedicated staging
workspace and surveys; the configured key must have permission to read survey
responses and generate single-use links. Do not commit the key or paste it into
the browser. Docker Compose forwards both variables to the backend.

The backend automatically creates `formbricks_templates` and
`formbricks_sessions` at startup. Existing templates and answers remain intact.
The database account needs CREATE TABLE permission. For a restricted runtime
account, have an operator run `backend/scripts/formbricks_migration.sql` first.

1. In Formbricks, create a **link survey**, configure questions and publish it.
2. Enable **single-use links** and turn **URL encryption off**. The Management
   API generates the invitation and its signature; this application does not
   generate or forge Formbricks signatures. Encrypted IDs cannot be matched to
   the decrypted response IDs by this app.
3. Log into the feedback app as an administrator, HR, or SC reviewer.
4. Open **Request feedback → Connect a Formbricks survey**.
5. Test the connection. Enter the survey ID or its `/s/<id>` URL, then connect.
6. Select the connected template and send a feedback request as usual.
7. The selected giver opens **Open feedback survey** and fills it. A new-tab
   fallback is available if the provider's frame policy blocks embedding.
8. Completion triggers a server-side verification. The open screen checks every
   15 seconds; a background job also retries active invitations every minute.
   The **Check submission** button retries immediately (with a five-second
   server cooldown). Only finished provider responses mark requests submitted.
9. Review the imported answers and use Acknowledge, discussion, follow-ups,
   and Close as before.

## Features and boundaries

| Capability | Behavior |
| --- | --- |
| Question types, multiple choice, ratings, NPS, dates, ranking, matrix, uploads | Rendered by the actual Formbricks survey; typed answer values are preserved as JSON |
| Conditional logic, optional questions, recall, validation, styling, media, languages | Configured in Formbricks; the app does not flatten the survey into text fields |
| Partial answers | Remain unsubmitted and private; reopen the same single-use invitation to resume where the provider supports it |
| Hidden fields and respondent/contact metadata | Not exposed in the imported feedback; only declared question answers are imported |
| Builder, survey analytics, CSV exports | Available in the connected Formbricks workspace, using its own login and permissions |
| Existing request scheduling and reminders | Continue to run in this app, including connected templates |
| Existing team analytics | Lifecycle totals include these requests; existing native 1–5 rating averages do not include Formbricks ratings/NPS |
| File answers | URLs/structured values are displayed as text; files remain hosted and governed by Formbricks, not copied into this app |
| Per-answer clarification | Native answer-row links are not created for external answers; request-level discussions still work |
| Paid integrations, webhooks, branding removal, advanced roles and workflows | Remain controlled by the Formbricks plan; connecting this app does not enable them |
| Website/app-triggered surveys, SDK targeting, contact sync | Not part of this link-survey integration |
| Cloud usage | Formbricks enforces the selected plan's limit; the app does not bypass it or claim an exact billing counter |

**Cloud Hobby currently lists 250 responses/month.** Consult the provider's
pricing page for current limits and entitlements. No paid plan is purchased by
this integration. Polling the Management API avoids requiring paid webhooks.

The provider response search is paginated with a 5,000-record safety bound. Use
a dedicated survey rather than mixing unrelated high-volume responses. Each
backend worker processes up to 25 pending invitations per minute. Closed,
cancelled, declined, hidden, or removed requests are not imported by the job.
Remote survey closure/response limits may prevent further submissions, and the
provider displays that condition in the survey UI.

## Versioning and privacy

Connected templates store the question/logic snapshot. Do not change a survey's
questions after connecting it. Duplicate it in Formbricks, edit and publish the
new version, then connect it under a new template name. The server detects
schema changes when opening and importing responses, instead of attaching new
answers to old question labels. Answers imported before a remote change retain
their original labels.

Only the assigned giver can obtain the invitation. Keep its URL private: like
any single-use invitation, it is a bearer link and can be forwarded. The backend
matches both survey ID and single-use ID through the authenticated Management
API. Browser completion messages only request a sync; they cannot forge a
submission. Repeated/concurrent completions import once under a database lock.
The browser never receives the API key. Provider redirects are rejected.

Formbricks workspace members with response access can see the answers there.
Existing app visibility controls govern the local copy, not the provider copy.
No giver name/email is intentionally added to the survey URL. The app's
anonymous-name redaction still applies; questions themselves may of course ask
for identifying information. Cancelling a local request prevents import but
does not remotely revoke an already issued provider invitation.

## Verification

```sh
node --test backend/tests/formbricks.test.js
npm run build
```

Database integration tests use a **disposable local MySQL database on a
non-default port**. Load `backend/scripts/schema.sql` into that database first.
The suite creates synthetic users/requests and uses an in-process mock
Formbricks server. Never point it at staging or production.

```sh
FORMBRICKS_TEST_DB=1 DB_HOST=127.0.0.1 DB_PORT=3317 \
DB_USER=root DB_PASSWORD='' DB_NAME=feedback_process \
node --test backend/tests/formbricks.integration.test.js
```

The real provider smoke test requires a configured API key and a published
survey. Verify upload access, resumption, conditional branches, provider plan
limits, and the actual iframe policy in the connected deployment before team
rollout. Passing mock tests does not establish these provider behaviors.

References:
- https://formbricks.com/docs/api-reference/management-api--survey/get-survey-by-id
- https://formbricks.com/docs/api-reference/management-api--response/get-survey-responses
- https://formbricks.com/docs/surveys/link-surveys/single-use-links
- https://formbricks.com/docs/surveys/link-surveys/embed-surveys
- https://formbricks.com/pricing

### Verified local Formbricks instance

The local Docker setup uses the official Formbricks 6.0.1 deployment, exposed
only at `http://localhost:3217`. Its generated configuration and secrets live in
ignored `.local/formbricks/`. Start it with:

```sh
sudo docker compose -f .local/formbricks/compose.yml up -d
```

The local app launcher reads `.local/formbricks/connection.json` when present
(`origin`, `apiKey`, `surveyId`). Explicit environment variables take precedence.
The API key needs workspace **write** access to generate single-use invitations;
read-only access can fetch a survey but the invitation endpoint returns 401.
No organization-level permissions or feedback-app administrator role are needed
for the seeded test flow. The survey is connected during local setup.

Verified against the real provider: normal-member request creation, unique
invitation generation, iframe rendering, text/rating/multi-select submission,
and completed-response import with the correct answers. File uploads are not
configured in this local instance. The Formbricks builder has its own local login.

### Explore survey

`node scripts/setup-formbricks-explore.mjs` creates an idempotent local-only
"Formbricks Explore — Choices, Dropdowns & More" survey and connects it as a
feedback template. It requires the existing ignored local connection file.
Its marker is `.local/formbricks/explore.json`. Existing feedback is preserved.

The survey has seven blocks and 18 elements: single-choice, single dropdown,
checkboxes, multi-select dropdown, short/long text, email and number inputs,
star/smiley/numeric ratings, NPS, CSAT, CES, consent, a Yes/No branch, conditional
follow-up text and a final statement. No skips the follow-up block; Yes shows it.
The actual provider was tested through both branches; submitted choice values,
arrays, written answers, scores and consent were verified in the feedback app.
File uploads, calendar booking and paid capabilities are not part of this demo.
Use a new connected survey version when changing questions for further tests.

## Create forms inside Feedback Process

Members can open Request feedback → Custom, enter a form name, add question types and options, and choose Save and use form. This creates a published single-use Formbricks survey in the server-configured `FORMBRICKS_WORKSPACE_ID` and selects the connected template. The API key needs workspace write access. The member never receives the key or chooses the workspace.

The inline editor supports text, long text, single/multiple choice, single/multiple dropdown, three rating styles, NPS, CSAT, CES, email, number and consent. It supports required answers and question ordering. Basic conditional display is supported as described below. Advanced compound rules, file upload and editing existing provider forms are not implemented in this editor. Existing forms retain their original question snapshot; create a new version to change questions.

## Conditional questions in Custom

1. Add an always-visible Single choice or Dropdown question with your own options (for example Yes/No).
2. Add a later follow-up question. Under **When to show this question**, select **Only when an answer matches**.
3. Choose the **Earlier question** and **Answer must be** value.
4. Save and use the form as usual. This compiles to actual Formbricks block logic, not frontend-only hiding.

Other answers skip that follow-up, even if it is required. An unanswered optional source also skips it. Common questions keep **Always show**. Multiple follow-ups can match the same answer and will appear in order. Conditions may reference only earlier, always-visible Single choice/Dropdown questions; nested dependencies, multi-select conditions, numerical comparisons and AND/OR rule groups are not exposed in this editor.

Question identity is retained when reordering the draft. Removing/changing the source or selected option, or moving the follow-up before its source, produces a visible error and blocks saving until the rule is repaired. Existing saved templates and feedback are unchanged; create a new form version to add conditions.

Verified locally: real Formbricks Yes/No branch routing, required visible-answer validation, skipping irrelevant required follow-ups, common rating, completed submissions, and ordinary-member creation from the Custom editor. Automated tests also cover ending fallback, adjacent matching branches and invalid references.


## Original Formbricks builder inside Feedback Process (local)

The **Formbricks builder** navigation item embeds the actual self-hosted Formbricks
UI, including its question editor, preview, styling and conditional logic. This
is separate from the existing **Custom** quick editor, which is preserved.
Saved forms also have **Open Formbricks builder here**. Existing feedback and
request drafts are preserved when opening the builder.

1. Start the local Docker Formbricks service on port 3217 and `npm run test:local`.
   The launcher starts a loopback-only embedding adapter on port 3218.
2. Open Feedback Process (the existing preview on port 3002 or local test app on
   port 3117) and select **Formbricks builder**.
3. Sign in inside the frame with your own Formbricks account. Its email must
   match your Feedback Process account. There is no automatic shared-admin login
   or account provisioning; workspace access is still managed by Formbricks.
4. In the native UI choose **New Survey → Start from scratch** or a template,
   enter your questions and options, preview and **Publish** a link form.
   The native product uses the word “Survey”; Feedback Process calls it a form.
5. Below the builder choose **Refresh my forms → Use for feedback**. Only forms
   created by your own matching provider account in the configured workspace
   appear. Draft forms must be published first. API-created forms from Custom
   remain accessible in Saved Formbricks forms.
6. The request panel opens with the form selected. Choose the giver and send
   manually. “Use for feedback” does not send requests. Existing fill, response
   verification, follow-up, acknowledgement and history flows are unchanged.

Connecting enables unencrypted single-use invitations for that form. Duplicate
connected forms before changing questions; snapshot checks protect old requests.
The API key stays on the backend. Matching email alone does not grant access:
the backend verifies a valid Formbricks session and checks form ownership.

This adapter is deliberately limited to the local deployment, not a production
SSO/hosting solution. It forwards only Formbricks cookies, translates the fixed
local origin for normal auth callbacks, preserves provider security directives,
and allows framing only by localhost ports 3000, 3001, 3002 and 3117. Production
mode disables this connection flow. A hosted rollout requires explicit provider
origin, embedding, account access and cookie configuration and separate testing.
Paid features remain subject to the provider edition. File storage is not
configured locally; embedding does not enable uploads or paid capabilities.

Verified locally: provider login inside the frame, original-editor creation,
draft listing, native publishing and selection in the feedback request panel.
The isolated verification form did not send a request to an employee.
