import { DEFAULT_SERVER_PORT } from '@cac/sim';
import { createGameServer } from './server.js';

const port = Number(process.env['PORT'] ?? DEFAULT_SERVER_PORT);
const server = await createGameServer(port);
console.log(`CAC-Lockstep-Server läuft auf ws://localhost:${server.port}`);
