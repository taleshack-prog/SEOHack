#!/usr/bin/env node
// Gera os segredos compartilhados entre este repo e o do site.
// Os DOIS valores precisam ser idênticos nos dois projetos da Vercel.
import { randomBytes } from 'node:crypto';
console.log(`PUBLISH_TOKEN="${randomBytes(32).toString('hex')}"`);
console.log(`F8_SIGNING_SECRET="${randomBytes(32).toString('hex')}"`);
console.log('\nColar em: SEOHack (SEO App) e no repo do site. Mesmos valores nos dois.');
