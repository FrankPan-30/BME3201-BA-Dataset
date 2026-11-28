export function withDeadline<T>(operation: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      onTimeout?.();
      reject(new Error('Camera operation timed out'));
    }, ms);
    operation.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

export const openCamera = () => {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('Camera API unavailable'));
  return navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24, max: 30 } },
    audio: false,
  });
};

export function releaseCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export type RecordedVideo = { blob: Blob | null; interrupted: boolean };

async function indexWebm(blob: Blob) {
  const { default: { Decoder, Reader, tools } } = await import('ts-ebml/dist/EBML.min.js');
  const reader = new Reader();
  for (const element of new Decoder().decode(await blob.arrayBuffer())) reader.read(element);
  reader.stop();
  if (!(reader.duration > 0) || !reader.metadataSize || !reader.cues.length) return blob;
  const header = tools.makeMetadataSeekable(reader.metadatas, reader.duration, reader.cues);
  return new Blob([header, blob.slice(reader.metadataSize)], { type: blob.type });
}

export function recordCamera(stream: MediaStream) {
  const candidates = ['video/webm;codecs=vp8', 'video/webm'];
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_800_000 });
  const chunks: Blob[] = [];
  let interrupted = false;
  let commandedStop = false;
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.addEventListener('error', () => { interrupted = true; });
  const stopped = new Promise<RecordedVideo>((resolve) => {
    recorder.addEventListener('stop', async () => {
      const raw = chunks.length ? new Blob(chunks, { type: recorder.mimeType }) : null;
      let blob = raw;
      if (raw?.type.includes('webm')) {
        try { blob = await indexWebm(raw); } catch (error) { console.warn('Video index:', error); }
      }
      resolve({ blob, interrupted: interrupted || !commandedStop });
    }, { once: true });
  });
  const started = new Promise<void>((resolve, reject) => {
    recorder.addEventListener('start', () => resolve(), { once: true });
    recorder.addEventListener('error', () => reject(new Error('Recording could not start')), { once: true });
  });
  recorder.start();
  return {
    started,
    stopped,
    pause: () => { if (recorder.state === 'recording') recorder.pause(); },
    resume: () => { if (recorder.state === 'paused') recorder.resume(); },
    stop: () => {
      commandedStop = true;
      if (recorder.state !== 'inactive') recorder.stop();
      return stopped;
    },
  };
}

export type Capture = ReturnType<typeof recordCamera>;


