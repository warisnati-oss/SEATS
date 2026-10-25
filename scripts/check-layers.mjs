#!/usr/bin/env node
// The dependency rule of a service's layers (README, "Inside a service"): the domain depends on nothing outside itself
// but the shared error kinds and the generated message types; the infrastructure depends on the domain (it implements
// the domain's ports) but never on the API layer; the API layer may use both. `node scripts/check-layers.mjs [service…]`
// exits 1 and names every import that breaks the rule; `npm run typecheck` runs it after the compilers.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const requested = process.argv.slice(2);
const services = (requested.length ? requested : readdirSync(join(ROOT, 'services')).map((s) => `services/${s}`)).map((s) => s.replace(/\/$/, ''));

// what a layer may import: anything matching one of its allowed patterns; everything else is a break
const RULES = {
  domain: {
    allowed: [/^\.\.?\//, /^node:/, /^@seats\/errors\b/, /^@seats\/proto\b/],
    forbidden: [/^\.\.\/(infrastructure|api)\b/, /^\.\/(infrastructure|api)\b/, /^@seats\/store\b/, /^mongoose$/, /^@grpc\//],
    why: 'the domain knows only its model, its rules, its ports, the error kinds and the message types',
  },
  infrastructure: {
    allowed: [/./],
    forbidden: [/^\.\.\/api\b/],
    why: 'the infrastructure implements the ports of the domain and never calls the API layer',
  },
};

const IMPORT = /^\s*(?:import|export)\b[^'"]*?\sfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|mts|js|mjs)$/.test(name)) yield p;
  }
}

const breaks = [];
for (const service of services) {
  for (const [layer, rule] of Object.entries(RULES)) {
    const dir = join(ROOT, service, 'src', layer);
    let entries;
    try { entries = [...files(dir)]; } catch { continue; }   // a service without this layer
    for (const file of entries) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(IMPORT)) {
        const spec = m[1] ?? m[2] ?? m[3];
        const ok = rule.allowed.some((r) => r.test(spec)) && !rule.forbidden.some((r) => r.test(spec));
        if (!ok) breaks.push({ file: relative(ROOT, file), spec, layer, why: rule.why });
      }
    }
  }
}

if (breaks.length) {
  for (const b of breaks) console.error(`${b.file}: imports '${b.spec}' from the ${b.layer} layer; ${b.why}`);
  console.error(`\n${breaks.length} import(s) break the dependency rule`);
  process.exit(1);
}
console.log(`layers: ${services.length} service(s) keep the dependency rule (domain → nothing, infrastructure → domain, api → both)`);
