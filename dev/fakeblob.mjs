// In-memory stand-in for @vercel/blob. Nothing here ever reaches the real store, and it
// all disappears when the server stops.
const store = globalThis.__blobs || (globalThis.__blobs = new Map());
export async function get(pathname) {
  if (!store.has(pathname)) { const e = new Error('not found'); e.name = 'BlobNotFoundError'; throw e; }
  return { statusCode: 200, stream: store.get(pathname) };
}
export async function put(pathname, body) { store.set(pathname, String(body)); return { pathname }; }
export async function list() { return { blobs: [...store.keys()].map((p) => ({ pathname: p })) }; }
export async function del(p) { store.delete(p); }
