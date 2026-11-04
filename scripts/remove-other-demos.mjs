import { Store } from '../src/store.mjs';
import { loadConfig } from '../src/config.mjs';
import { removeDemoAssessments } from '../src/maintenance.mjs';

const { dataFile } = loadConfig();
console.log(`Database: ${dataFile}`);
const store = new Store(dataFile);
try {
  const summary = removeDemoAssessments(store);
  console.log(JSON.stringify(summary));
} finally { store.close(); }
