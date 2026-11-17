/** Native gzip via the Compression Streams API (no dependency). */
export async function gzip(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return pipe(data, new CompressionStream('gzip'));
}

export async function gunzip(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return pipe(data, new DecompressionStream('gzip'));
}

async function pipe(
  data: Uint8Array<ArrayBuffer>,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const stream = source.pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
