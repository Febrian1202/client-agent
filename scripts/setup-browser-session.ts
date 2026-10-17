import { resolve } from 'path';
import { config } from '@client-agent/config';
import { launchPersistentContext } from '@client-agent/browser';

const profilePath = resolve(config.BROWSER_PROFILE_PATH);

console.log('VGen one-time login setup');
console.log(`Browser profile directory: ${profilePath}`);
console.log('Log in to VGen, then close the browser window.');

const ctx = await launchPersistentContext({ profilePath, headless: false });

await new Promise<void>((resolveClose) => {
  ctx.on('close', () => resolveClose());
});

console.log('Browser window closed. Session cookies are stored in the profile directory.');
process.exit(0);
