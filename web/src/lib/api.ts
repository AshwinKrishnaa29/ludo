/**
 * Every request is same-origin: in development Vite proxies to the services,
 * in production the gateway and ingress do. Nothing here needs a base URL.
 */

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `http_${res.status}`);
  return body;
}

function auth(token: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function post<T>(path: string, body?: unknown, token?: string | null): Promise<T> {
  // Fastify rejects a request that declares a JSON content-type but sends no
  // body, so the header is only set when there is something to send.
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...auth(token ?? null),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return parse<T>(res);
}

export async function get<T>(path: string, token?: string | null): Promise<T> {
  const res = await fetch(path, { credentials: 'include', headers: auth(token ?? null) });
  return parse<T>(res);
}

/** Minimal GraphQL client - the BFF is the only consumer, so a helper beats a library. */
export async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string | null,
): Promise<T> {
  const res = await fetch('/graphql', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...auth(token) },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  if (!body.data) throw new Error('empty_response');
  return body.data;
}