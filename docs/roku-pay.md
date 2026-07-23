# Roku Pay Web Services

Editor-tab tool for calling [Roku Pay Web Services](https://developer.roku.com/dev/docs/roku-web-service)
and the [subscription-recovery test endpoints](https://developer.roku.com/dev/docs/testing-1)
directly from VS Code. Unlike every other tool in the extension it talks to
**Roku's cloud API** (`apipub.roku.com`), not to a device — no device
selection, discovery, or password is involved.

Open it with **`Kopytko: Open Roku Pay Web Services`** (command palette) or the
**Roku Pay Web Services** button in the Kopytko Tools sidebar. The panel is a
singleton editor tab — reopening reveals the existing one.

## Credential profiles

Requests authenticate with a **partner API key** (from the Developer
Dashboard). The tool stores any number of named profiles — e.g. one per
channel or partner account:

| Field | Stored in |
|---|---|
| Name | global Memento |
| Partner API Key | **SecretStorage (OS keychain)** — never in settings, Memento, logs, or the webview |
| Partner Reference ID | global Memento; prefills the matching form field |

Editing a profile with a blank key field keeps the existing key (same
convention as Device Manager credentials). Deleting a profile deletes its key
from the keychain. The **transaction id is deliberately not part of a
profile** — it changes with every purchase; the form remembers the last-used
value instead.

## Endpoints

Selecting an endpoint renders a form with exactly the fields that endpoint
needs; same-named values (e.g. `transactionId`) carry over when switching.
The API key row shows *"✓ from profile"* — the key is injected on the
extension host and never rendered.

### Transaction service (`…/listen/transaction-service.svc`)

Rate limit: **20 requests/second** per API key.

| Endpoint | Method | Fields (beyond the key) |
|---|---|---|
| Validate Transaction | GET | transactionId |
| Validate Refund | GET | refundId |
| Cancel Subscription | POST | transactionId, cancellationDate, dontNotifyUser, partnerReferenceId |
| Refund Subscription | POST | transactionId, amount, partnerReferenceId, comments |
| Update Billing Cycle | POST | transactionId, newBillCycleDate |
| Issue Service Credit | POST | amount, channelId, productId, rokuCustomerId, partnerReferenceId, comments |

The **Accept** selector requests `application/json` (default, pretty-printed)
or `application/xml` (rendered raw). Roku Pay's backend serializes dates
ASP.NET-AJAX style — `/Date(1784727028679+0000)/` — in both JSON and XML;
the response viewer converts these tokens to a readable UTC timestamp
(`YYYY-MM-DDTHH:mm:ss`) for display, everything else in the body is shown
verbatim.

### Subscription recovery — TEST endpoints (`…/test/subscription-recovery/…`)

Simulate the recovery lifecycle against a **beta app + test user**
subscription (see Roku's [testing guide](https://developer.roku.com/dev/docs/testing-1)):

| Transition | Endpoint |
|---|---|
| active → in-grace | `grace-period-state` |
| in-grace → on-hold | `passive-onhold-state` |
| passively cancel | `deactivated-state` |
| recover (from in-grace/on-hold) | `recover` |

All four are empty-body POSTs with the key and transaction id in the path.
**Rate limit: 10 requests/minute — exceeding it may revoke API access**, and
state changes take 10–30 minutes to process; the form shows this warning for
every recovery-test endpoint. Typical flow: purchase with the test user
(avoid free trials), record the transaction id, walk the transitions in
order, verify each with Validate Transaction (or push notifications), void
transactions before the next run.

## Request history

Every request/response is appended to a persistent history (global Memento):
timestamp, endpoint, profile name, method, URL, request body, response
status/headers/body, and duration — or the network error when no response
arrived. Click an entry to reload it into the response viewer; delete entries
individually or **Clear all** (two-step confirm).

Bounds: the newest **200 entries** are kept (oldest trimmed on insert) and
response bodies are truncated at **64 KB** before persisting.

**Masking guarantee:** the partner API key is replaced with `****` (raw and
URL-encoded forms) in the URL, request body, and error messages *before* an
entry is stored or shown — the key exists only in the OS keychain and
transiently on the extension host while sending.

## Implementation notes

- Requests execute on the **extension host** via Node's global `fetch`
  (webview CSP allows no network). Known limitation: this bypasses VS Code's
  proxy settings (`http.proxy`) — direct internet access is assumed.
- Source: `src/client/rokuPay/` — declarative endpoint catalog
  (`endpoints.ts`), profile/log stores, controller (validation, coercion,
  masking), `views/rokuPayPanel.ts`, and the esbuild-bundled webview.
