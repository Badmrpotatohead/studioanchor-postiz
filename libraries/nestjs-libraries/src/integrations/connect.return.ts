// connect-return-v1: a channel connect started through the public API can name
// a return target. Only exact origins listed in POSTIZ_CONNECT_RETURN_ORIGINS
// are accepted; without that variable the public API behaves as upstream.
// This file has no imports so its checks can be tested in isolation.

export const CONNECT_RETURN_PROTOCOL = 'connect-return-v1';
// Matches the lifetime of the OAuth state it is stored next to.
export const CONNECT_RETURN_TTL_SECONDS = 3600;
const MAX_TARGET_LENGTH = 2048;

export interface ConnectReturnStore {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface ConnectReturnIntent {
  target: string;
  provider: string;
}

export interface ConnectReturnTargets {
  connected: string;
  failed: string;
}

// Each configured entry must be an exact HTTPS origin; anything else is
// ignored, so a malformed configuration fails closed.
export function connectReturnOrigins(
  value: string | undefined = process.env.POSTIZ_CONNECT_RETURN_ORIGINS
): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => {
      try {
        const url = new URL(item);
        return (
          url.protocol === 'https:' &&
          url.origin === item &&
          /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(item)
        );
      } catch {
        return false;
      }
    });
}

// Returns the canonical target, or null when it is not an exact allowlisted
// origin. The caller chooses the path and query; never the origin.
export function validateConnectReturn(
  value: unknown,
  origins: string[]
): string | null {
  if (typeof value !== 'string' || !value || value.length > MAX_TARGET_LENGTH) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.href !== value ||
    !origins.includes(url.origin)
  ) {
    return null;
  }
  return url.href;
}

function key(state: string) {
  return `connect-return:${state}`;
}

function validState(state: unknown): state is string {
  return typeof state === 'string' && state.length > 0 && state.length <= 512;
}

export async function saveConnectReturn(
  store: ConnectReturnStore,
  state: string,
  intent: ConnectReturnIntent
) {
  await store.set(
    key(state),
    JSON.stringify(intent),
    'EX',
    CONNECT_RETURN_TTL_SECONDS
  );
}

// One use: the intent is removed whether or not it matches the provider.
// The target is re-validated against the current allowlist.
export async function takeConnectReturn(
  store: ConnectReturnStore,
  state: unknown,
  provider: string,
  origins: string[] = connectReturnOrigins()
): Promise<ConnectReturnIntent | null> {
  if (!validState(state)) {
    return null;
  }
  const raw = await store.get(key(state));
  if (!raw) {
    return null;
  }
  await store.del(key(state));
  try {
    const intent = JSON.parse(raw) as ConnectReturnIntent;
    const target = validateConnectReturn(intent?.target, origins);
    if (!target || intent.provider !== provider) {
      return null;
    }
    return { target, provider };
  } catch {
    return null;
  }
}

export function connectReturnTargets(
  intent: ConnectReturnIntent
): ConnectReturnTargets {
  const outcome = (value: 'connected' | 'failed') => {
    const url = new URL(intent.target);
    url.searchParams.set('connect', value);
    return url.toString();
  };
  return { connected: outcome('connected'), failed: outcome('failed') };
}
