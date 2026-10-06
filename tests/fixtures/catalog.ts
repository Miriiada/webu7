import { readFileSync } from 'node:fs';
import type { Catalog } from '../../server/content.js';

// Stable bot messages must be tested against their original curriculum snapshot.
export function historicalCatalog(): Catalog {
  return JSON.parse(readFileSync('tests/fixtures/catalog.json', 'utf8'));
}
