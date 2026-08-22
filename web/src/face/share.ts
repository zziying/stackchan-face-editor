// URL-as-sharing (S6/Q6): face.json deflated + base64url into the hash.
// Prefix marks encoding: z = deflate-raw, r = plain utf-8 (fallback for
// browsers without CompressionStream).
import type { FaceDoc } from './types';

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: { readable: ReadableStream; writable: WritableStream }): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeShareHash(doc: FaceDoc): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(doc));
  if (typeof CompressionStream !== 'undefined') {
    const packed = await pipe(raw, new CompressionStream('deflate-raw'));
    return '#f=z' + b64urlEncode(packed);
  }
  return '#f=r' + b64urlEncode(raw);
}

export async function decodeShareHash(hash: string): Promise<FaceDoc | null> {
  const m = hash.match(/^#f=([zr])(.+)$/);
  if (!m) return null;
  try {
    let bytes = b64urlDecode(m[2]);
    if (m[1] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    const doc = JSON.parse(new TextDecoder().decode(bytes));
    return doc && doc.version === 1 ? (doc as FaceDoc) : null;
  } catch {
    return null;
  }
}
