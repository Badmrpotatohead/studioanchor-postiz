// disconnect-purge-v1: deleting a channel erases its stored credentials and
// identifying fields in the same update that sets deletedAt. internalId,
// rootInternalId, providerIdentifier and organizationId are kept: the
// organizationId_internalId uniqueness and reconnect logic need them. Posts and
// the dispatch-fence columns are never touched here.
// This file has no imports so its checks can be tested in isolation.

export const DISCONNECT_PURGE_PROTOCOL = 'disconnect-purge-v1';
export const PURGED_INTEGRATION_NAME = 'Disconnected account';
export const REVOKE_TIMEOUT_MS = 10_000;

export interface PurgedIntegrationData {
  token: string;
  refreshToken: string | null;
  tokenExpiration: Date | null;
  name: string;
  picture: string | null;
  profile: string | null;
  customInstanceDetails: string | null;
  additionalSettings: string;
}

export function purgedIntegrationData(): PurgedIntegrationData {
  return {
    // token is a required column, so the empty string is its cleared value.
    token: '',
    refreshToken: null,
    tokenExpiration: null,
    name: PURGED_INTEGRATION_NAME,
    picture: null,
    profile: null,
    customInstanceDetails: null,
    additionalSettings: '[]',
  };
}

const NOT_NULL = { not: null as null };

// Deleted rows that still hold a credential or identifying field.
export function unpurgedDeletedIntegrationWhere() {
  return {
    deletedAt: NOT_NULL,
    OR: [
      { token: { not: '' } },
      { refreshToken: NOT_NULL },
      { tokenExpiration: NOT_NULL },
      { name: { not: PURGED_INTEGRATION_NAME } },
      { picture: NOT_NULL },
      { profile: NOT_NULL },
      { customInstanceDetails: NOT_NULL },
      { additionalSettings: { not: '[]' } },
    ],
  };
}

export function isPurgedIntegration(row: {
  token: string;
  refreshToken: string | null;
  tokenExpiration?: Date | null;
  name: string;
  picture: string | null;
  profile: string | null;
  customInstanceDetails: string | null;
  additionalSettings?: string | null;
}) {
  return (
    row.token === '' &&
    row.refreshToken === null &&
    (row.tokenExpiration ?? null) === null &&
    row.name === PURGED_INTEGRATION_NAME &&
    row.picture === null &&
    row.profile === null &&
    row.customInstanceDetails === null &&
    (row.additionalSettings ?? '[]') === '[]'
  );
}

// Best-effort provider revocation: bounded, never throws, never follows a
// redirect, and reports only whether the provider accepted the request.
export async function revokeRequest(
  url: string,
  init: RequestInit
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
}

export function formRequest(
  fields: Record<string, string>,
  headers: Record<string, string> = {}
): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  };
}

export function basicAuth(id: string | undefined, secret: string | undefined) {
  return {
    Authorization: `Basic ${Buffer.from(`${id ?? ''}:${secret ?? ''}`).toString(
      'base64'
    )}`,
  };
}
