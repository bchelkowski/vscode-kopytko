/**
 * Declarative catalog of the Roku Pay Web Services endpoints
 * (https://developer.roku.com/dev/docs/roku-web-service) plus the
 * subscription-recovery TEST endpoints
 * (https://developer.roku.com/dev/docs/testing-1).
 *
 * Import-free on purpose: this module is bundled into the browser webview
 * (form rendering) AND used host-side (URL/body building) — keep it free of
 * `vscode`/Node imports, like the webview protocol files.
 */

export type PayFieldType = 'string' | 'number' | 'boolean' | 'date';

export interface PayField {
  /** Placeholder name in the URL template or property name in the JSON body. */
  name: string;
  label: string;
  type: PayFieldType;
  /** Where the value is serialized: URL path segment or JSON body property. */
  in: 'path' | 'body';
  required: boolean;
  /**
   * The partner API key. Never rendered as an editable input — the webview
   * shows a "from profile" indicator and the controller injects the real key
   * host-side, so the key never reaches the webview.
   */
  secret?: boolean;
  /** Prefill the input from the selected credential profile. */
  prefillFrom?: 'partnerReferenceId';
  /** Short hint rendered under the input. */
  help?: string;
}

export interface PayEndpoint {
  id: string;
  label: string;
  category: 'web-services' | 'recovery-test';
  method: 'GET' | 'POST';
  /** Absolute URL with `{fieldName}` placeholders for `in: 'path'` fields. */
  urlTemplate: string;
  fields: PayField[];
  description: string;
  rateLimitNote: string;
}

const WEB_BASE = 'https://apipub.roku.com/listen/transaction-service.svc';
const TEST_BASE = 'https://apipub.roku.com/test/subscription-recovery';

const WEB_RATE_LIMIT = 'Rate limit: 20 requests per second per API key.';
const TEST_RATE_LIMIT =
  'Rate limit: 10 requests per MINUTE — exceeding it may revoke API access. State changes take 10–30 minutes to process.';

const apiKeyPath: PayField = {
  name: 'partnerAPIKey', label: 'Partner API Key', type: 'string', in: 'path', required: true, secret: true,
};
const apiKeyBody: PayField = {
  name: 'partnerAPIKey', label: 'Partner API Key', type: 'string', in: 'body', required: true, secret: true,
};
const transactionIdPath: PayField = {
  name: 'transactionId', label: 'Transaction ID', type: 'string', in: 'path', required: true,
  help: 'The transaction id returned by the purchase (roTransactionId).',
};
const transactionIdBody: PayField = { ...transactionIdPath, in: 'body' };
const partnerReferenceId: PayField = {
  name: 'partnerReferenceId', label: 'Partner Reference ID', type: 'string', in: 'body', required: false,
  prefillFrom: 'partnerReferenceId',
  help: 'Your own reference id, echoed back in reports.',
};

function recoveryTestEndpoint(id: string, label: string, description: string): PayEndpoint {
  return {
    id,
    label,
    category: 'recovery-test',
    method: 'POST',
    urlTemplate: `${TEST_BASE}/${id}/{partnerAPIKey}/{transactionId}`,
    fields: [apiKeyPath, transactionIdPath],
    description,
    rateLimitNote: TEST_RATE_LIMIT,
  };
}

export const PAY_ENDPOINTS: PayEndpoint[] = [
  {
    id: 'validate-transaction',
    label: 'Validate Transaction',
    category: 'web-services',
    method: 'GET',
    urlTemplate: `${WEB_BASE}/validate-transaction/{partnerAPIKey}/{transactionId}`,
    fields: [apiKeyPath, transactionIdPath],
    description: 'Verify a customer’s entitlement to an in-app product; returns transaction details, expiration date and the isEntitled flag.',
    rateLimitNote: WEB_RATE_LIMIT,
  },
  {
    id: 'validate-refund',
    label: 'Validate Refund',
    category: 'web-services',
    method: 'GET',
    urlTemplate: `${WEB_BASE}/validate-refund/{partnerAPIKey}/{refundId}`,
    fields: [
      apiKeyPath,
      {
        name: 'refundId', label: 'Refund ID', type: 'string', in: 'path', required: true,
        help: 'The refund id returned by Refund Subscription (not a transaction id).',
      },
    ],
    description: 'Confirm whether a refund has been processed; returns the refund transaction details.',
    rateLimitNote: WEB_RATE_LIMIT,
  },
  {
    id: 'cancel-subscription',
    label: 'Cancel Subscription',
    category: 'web-services',
    method: 'POST',
    urlTemplate: `${WEB_BASE}/cancel-subscription`,
    fields: [
      apiKeyBody,
      transactionIdBody,
      {
        name: 'cancellationDate', label: 'Cancellation Date', type: 'date', in: 'body', required: false,
        help: 'ISO 8601 (YYYY-MM-DD); omit to cancel immediately.',
      },
      {
        name: 'dontNotifyUser', label: 'Don’t notify the user', type: 'boolean', in: 'body', required: false,
        help: 'Suppress the cancellation email to the customer.',
      },
      partnerReferenceId,
    ],
    description: 'Cancel a subscription.',
    rateLimitNote: WEB_RATE_LIMIT,
  },
  {
    id: 'refund-subscription',
    label: 'Refund Subscription',
    category: 'web-services',
    method: 'POST',
    urlTemplate: `${WEB_BASE}/refund-subscription`,
    fields: [
      apiKeyBody,
      transactionIdBody,
      {
        name: 'amount', label: 'Amount', type: 'number', in: 'body', required: true,
        help: 'Tax-exclusive amount to refund (partial or full).',
      },
      partnerReferenceId,
      { name: 'comments', label: 'Comments', type: 'string', in: 'body', required: false },
    ],
    description: 'Issue a partial or full refund for a subscription; returns a RefundId usable with Validate Refund.',
    rateLimitNote: WEB_RATE_LIMIT,
  },
  {
    id: 'update-bill-cycle',
    label: 'Update Billing Cycle',
    category: 'web-services',
    method: 'POST',
    urlTemplate: `${WEB_BASE}/update-bill-cycle`,
    fields: [
      apiKeyBody,
      transactionIdBody,
      {
        name: 'newBillCycleDate', label: 'New Bill Cycle Date', type: 'date', in: 'body', required: true,
        help: 'ISO 8601 (YYYY-MM-DD).',
      },
    ],
    description: 'Move a subscription’s next billing date.',
    rateLimitNote: WEB_RATE_LIMIT,
  },
  {
    id: 'issue-service-credit',
    label: 'Issue Service Credit',
    category: 'web-services',
    method: 'POST',
    urlTemplate: `${WEB_BASE}/issue-service-credit`,
    fields: [
      apiKeyBody,
      {
        name: 'amount', label: 'Amount', type: 'number', in: 'body', required: true,
        help: 'Credit amount to grant.',
      },
      { name: 'channelId', label: 'Channel ID', type: 'string', in: 'body', required: true },
      {
        name: 'productId', label: 'Product ID', type: 'string', in: 'body', required: false,
        help: 'Optional — limits the credit to one in-app product.',
      },
      { name: 'rokuCustomerId', label: 'Roku Customer ID', type: 'string', in: 'body', required: true },
      partnerReferenceId,
      { name: 'comments', label: 'Comments', type: 'string', in: 'body', required: false },
    ],
    description: 'Grant a service credit to a Roku account, app-wide or for a specific product.',
    rateLimitNote: WEB_RATE_LIMIT,
  },
  recoveryTestEndpoint(
    'grace-period-state',
    'Recovery Test: Active → In-Grace',
    'TEST: move an active subscription into the in-grace period (simulates a payment failure).',
  ),
  recoveryTestEndpoint(
    'passive-onhold-state',
    'Recovery Test: In-Grace → On-Hold',
    'TEST: move an in-grace subscription to on-hold.',
  ),
  recoveryTestEndpoint(
    'deactivated-state',
    'Recovery Test: Passively Cancel',
    'TEST: passively cancel (deactivate) the subscription.',
  ),
  recoveryTestEndpoint(
    'recover',
    'Recovery Test: Recover',
    'TEST: recover the subscription from the in-grace or on-hold state.',
  ),
];

export function getEndpoint(id: string): PayEndpoint | undefined {
  return PAY_ENDPOINTS.find((endpoint) => endpoint.id === id);
}
