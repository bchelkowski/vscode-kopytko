# Roku Pay Web Services API — findings

## Dates are serialized ASP.NET-AJAX style, even in XML

Roku Pay's cloud API (`apipub.roku.com`) serializes date fields (e.g.
`expirationDate` on `validate-transaction`) as
`/Date(1784727028679+0000)/` — the old ASP.NET AJAX JSON date convention
(epoch milliseconds, optional `+HHMM`/`-HHMM` offset suffix). This is not
limited to `application/json` responses: requesting `application/xml`
still returns dates in this same token form embedded in the XML text, not
as ISO-8601. `docs/roku-pay.md` documents XML as "rendered raw," which is
otherwise accurate — the backend itself just doesn't produce ISO dates in
either format.

Because of this, the response viewer (`src/client/rokuPay/webview/main.ts`)
applies a display-only regex transform (`humanizeDotNetDates`, next to
`prettyBody()`) that converts `/Date(ms[+offset])/` tokens to
`YYYY-MM-DDTHH:mm:ss` (UTC) for both the JSON and XML render paths. This
only affects what's rendered in the `<pre class="response-body">` element —
`entry.responseBody` as persisted via `rokuPayLogStore.ts` (and the API-key
masking guarantee) is never mutated, so history entries still round-trip
the exact original bytes.

Do not confuse this with `entry.timestamp` (the request send time, shown
via `toLocaleString()` in the response status line and History list) — that
value is generated locally by the extension host (`Date.now()` in
`rokuPayController.ts`) and has nothing to do with the API's date
serialization quirk. Don't route it through `humanizeDotNetDates`.
