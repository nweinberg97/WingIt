// Module worker hosting WebLLM so inference never blocks the UI thread.
// The library comes from this site (vendor/), checked against its fingerprint by the integrity guard.
import { WebWorkerMLCEngineHandler } from '../../vendor/web-llm.js';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
