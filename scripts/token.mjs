// npm run token:generate - prints a random API token (48 hex chars). Nothing is stored; put it in .env as OPSDESK_API_TOKEN.
import { randomBytes } from 'node:crypto';
console.log(randomBytes(24).toString('hex'));
