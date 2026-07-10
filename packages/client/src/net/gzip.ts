/**
 * gzip+base64 codec for save-game blobs. A late-game serialized GameState is
 * 1–3 MB of JSON; gzip brings it down to ~100–300 KB. Prefixes keep the format
 * self-describing: "gz:" = compressed, "raw:" = plain (fallback for browsers
 * without CompressionStream — all current targets have it, Safari ≥ 16.4).
 */

const hasCompressionStream = typeof CompressionStream !== 'undefined';

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const STEP = 0x8000; // keep String.fromCharCode within argument limits
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function gzipToBase64(text: string): Promise<string> {
  if (!hasCompressionStream) return `raw:${text}`;
  const input = new Blob([new TextEncoder().encode(text)]);
  const compressed = await streamToBytes(input.stream().pipeThrough(new CompressionStream('gzip')));
  return `gz:${bytesToBase64(compressed)}`;
}

export async function gunzipFromBase64(data: string): Promise<string> {
  if (data.startsWith('raw:')) return data.slice(4);
  if (!data.startsWith('gz:')) throw new Error('Unbekanntes Spielstand-Format.');
  const bytes = base64ToBytes(data.slice(3));
  // Copy into a fresh ArrayBuffer-backed view — Blob rejects ArrayBufferLike.
  const stream = new Blob([bytes.slice().buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await streamToBytes(stream));
}
