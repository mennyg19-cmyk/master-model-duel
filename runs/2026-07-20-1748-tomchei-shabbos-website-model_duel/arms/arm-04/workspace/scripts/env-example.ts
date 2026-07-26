import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { renderEnvExample } from '../src/lib/env-spec';

const target = path.resolve(process.cwd(), '.env.example');
writeFileSync(target, renderEnvExample(), { encoding: 'utf8' });
console.log(`Wrote ${target}`);
