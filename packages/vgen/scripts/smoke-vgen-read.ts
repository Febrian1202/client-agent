import { config } from '@client-agent/config';
import { launchPersistentContext } from '@client-agent/browser';
import { VGenBrowserAdapter } from '../src/adapter';
import { THREAD_MESSAGE_SELECTOR } from '../src/selectors';

async function main() {
  const args = process.argv.slice(2);
  const username = args.find((arg) => !arg.startsWith('--'));
  const isDump = args.includes('--dump');

  if (!username) {
    console.error('Usage: bun run packages/vgen/scripts/smoke-vgen-read.ts <username> [--dump]');
    process.exit(1);
  }

  const profilePath = config.BROWSER_PROFILE_PATH;
  console.log(`[smoke-vgen-read] Using profile path: ${profilePath}`);

  const ctx = await launchPersistentContext({
    profilePath,
    headless: true,
  });

  const page = await ctx.newPage();

  try {
    const adapter = new VGenBrowserAdapter({
      createPage: async () => page,
      closePage: async (p) => {
        await p.close();
      },
    });

    const result = await adapter.getConversation({ clientUsername: username, limit: 20 });
    console.log(JSON.stringify(result, null, 2));

    if (isDump) {
      console.log('\n--- DUMP: Raw message block outerHTML (up to 5) ---');
      const blocks = await page.locator(THREAD_MESSAGE_SELECTOR).all();
      const sample = blocks.slice(-5);
      for (let i = 0; i < sample.length; i++) {
        const block = sample[i]!;
        const html = await block.evaluate((el) => el.outerHTML);
        console.log(`\n[Block ${i + 1}]:\n${html}`);
      }
    }
  } finally {
    await ctx.close();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('[smoke-vgen-read] Error:', err);
    process.exit(1);
  });
}
