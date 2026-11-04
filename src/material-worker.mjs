import { parentPort, workerData } from 'node:worker_threads';
import { extractMaterial } from './materials.mjs';
try {
  parentPort.postMessage({ result: await extractMaterial(workerData) });
} catch (error) {
  parentPort.postMessage({ error: { message: error.message, code: error.code, status: error.status } });
}
