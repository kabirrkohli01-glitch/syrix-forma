/* Smallest possible check that the gateway answers at all.
   Dev-only, not imported by the app. */
import { chat } from '../lib/ai/gateway/client';

async function main(): Promise<void> {
  process.stdout.write('pinging gateway...\n');
  const started = Date.now();

  const result = await chat({
    tier: 'spark',
    carriesHubContext: false,
    maxTokens: 60,
    timeoutMs: 45_000,
    messages: [{ role: 'user', content: 'Reply with exactly: PONG' }]
  });

  process.stdout.write(`\nprovider: ${result.provider} (${result.model})\n`);
  process.stdout.write(`took:     ${Date.now() - started}ms\n`);
  process.stdout.write(`text:     ${JSON.stringify(result.text)}\n`);
  if (result.skipped.length) {
    process.stdout.write(`skipped:  ${result.skipped.map((s) => `${s.provider}: ${s.reason}`).join('; ')}\n`);
  }
}

main().catch((error: unknown) => {
  process.stdout.write(`\nFAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
