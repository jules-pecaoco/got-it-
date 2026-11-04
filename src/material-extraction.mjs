import { Worker } from 'node:worker_threads';
let active = 0;
export async function extractMaterialBounded(input) {
  if (active >= 2)
    throw Object.assign(new Error('Material extraction is busy. Retry shortly.'), {
      status: 503,
      code: 'MATERIAL_BUSY',
    });
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./material-worker.mjs', import.meta.url), {
        workerData: input,
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(
          Object.assign(new Error('Material extraction exceeded its time limit.'), {
            status: 422,
            code: 'MATERIAL_TIMEOUT',
          }),
        );
      }, 15000);
      worker.once('message', (message) => {
        clearTimeout(timer);
        void worker.terminate();
        if (message.error) reject(Object.assign(new Error(message.error.message), message.error));
        else resolve(message.result);
      });
      worker.once('error', () => {
        clearTimeout(timer);
        reject(
          Object.assign(new Error('Material extraction interrupted.'), {
            status: 503,
            code: 'MATERIAL_UNAVAILABLE',
          }),
        );
      });
      worker.once('exit', () => {
        clearTimeout(timer);
        reject(
          Object.assign(new Error('Material extraction interrupted.'), {
            status: 503,
            code: 'MATERIAL_UNAVAILABLE',
          }),
        );
      });
    });
  } finally {
    active--;
  }
}
