import type { Trial } from './model';

let opened: Promise<IDBDatabase> | undefined;

function db() {
  if (!opened) {
    opened = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('bme3201-motion-lab', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('trials', { keyPath: 'id' });
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          opened = undefined;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      opened = undefined;
      throw error;
    });
  }
  return opened;
}

export async function readTrials(): Promise<Trial[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('trials').objectStore('trials').getAll();
    request.onsuccess = () => resolve((request.result as Trial[]).sort((a, b) => b.started - a.started));
    request.onerror = () => reject(request.error);
  });
}

export async function writeTrial(trial: Trial) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('trials', 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.objectStore('trials').put(trial);
  });
}

export async function deleteTrial(id: string) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('trials', 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.objectStore('trials').delete(id);
  });
}

/** Remove only the recorded video Blob while keeping scores, phases, annotations, and clinical notes intact. */
export function stripTrialVideo(trial: Trial): Trial {
  return {
    ...trial,
    video: null,
    videoTime: 0,
    videoState: 'none',
  };
}

export type LocalStorageSummary = {
  totalTrials: number;
  videoTrials: number;
  videoBytes: number;
};

export function summarizeLocalStorage(trials: readonly Trial[]): LocalStorageSummary {
  let videoTrials = 0;
  let videoBytes = 0;
  for (const trial of trials) {
    if (trial.video && trial.video.size > 0) {
      videoTrials++;
      videoBytes += trial.video.size;
    }
  }
  return {
    totalTrials: trials.length,
    videoTrials,
    videoBytes,
  };
}
