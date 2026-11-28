import { livePoseConfig } from './poseConfig.ts';
import { readLiveHeader, readLivePacket, type LiveHeader, type LivePacket } from './livePose.ts';

export type ReadablePoseFile = { name: string; getFile(): Promise<Blob> };
type Sink = { header(value: LiveHeader): void; packet(value: LivePacket): void; invalidPacket(): void; failed(): void };

/** An append-only UTF-8 stream. Decode complete lines only, keeping a writer's split final line for the next poll. */
export function followPoseFile(handle: ReadablePoseFile, sink: Sink, settings: { pollMs: number; readChunkBytes: number; maxLineBytes: number } = livePoseConfig) {
  const decoder = new TextDecoder();
  let offset = 0;
  let carry = '';
  let active = true;
  let header = false;
  let timer: ReturnType<typeof setTimeout>;
  let readFailures = 0;

  function stop() { active = false; clearTimeout(timer); }

  async function poll() {
    try {
      const file = await handle.getFile();
      if (!active) return;
      if (file.size < offset) { stop(); sink.failed(); return; }
      for (let chunks = 0; offset < file.size && chunks < 4; chunks++) {
        const target = Math.min(offset + settings.readChunkBytes, file.size);
        const bytes = await file.slice(offset, target).arrayBuffer();
        if (!active) return;
        offset += bytes.byteLength;
        const lines = (carry + decoder.decode(bytes, { stream: true })).split('\n');
        carry = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          if (line.length > settings.maxLineBytes) { stop(); sink.failed(); return; }
          if (!header) {
            try { sink.header(readLiveHeader(JSON.parse(line))); header = true; }
            catch { stop(); sink.failed(); return; }
          } else {
            try { sink.packet(readLivePacket(JSON.parse(line))); }
            catch { sink.invalidPacket(); }
          }
        }
        if (carry.length > settings.maxLineBytes) { stop(); sink.failed(); return; }
      }
      readFailures = 0;
    } catch {
      // Files that grow while Chromium reads them can fail a snapshot. Retry from the last committed byte.
      if (++readFailures >= 10) { stop(); sink.failed(); }
    }
    if (active) timer = setTimeout(poll, settings.pollMs);
  }
  void poll();
  return stop;
}

export async function pickLivePoseFile() {
  const picker = (window as Window & {
    showOpenFilePicker?: (options: { multiple: boolean; types: { description: string; accept: Record<string, string[]> }[] })
      => Promise<ReadablePoseFile[]>;
  }).showOpenFilePicker;
  if (!picker) return undefined;
  const [handle] = await picker.call(window, { multiple: false, types: [{ description: 'IMU JSON Lines', accept: {
    'application/json': ['.jsonl', '.ndjson'],
  } }] });
  return handle;
}
