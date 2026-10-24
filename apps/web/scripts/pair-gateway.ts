/* Connect this installation to the model gateway.
 *
 * WHAT THIS DOES AND DOES NOT DO. It exchanges a pairing code for a DEVICE TOKEN
 * belonging to this installation, and writes only that token into `.env.local`.
 * It does not copy, read, print or store any provider key, and it does not keep
 * the pairing code. The token is scoped to this device and can be revoked on its
 * own without affecting anything else that has ever paired.
 *
 * This is why SYRIX Forma never holds a provider key. The keys live as secrets on
 * the operator's Cloudflare Worker, which does the failover between providers on
 * its own side; a compromised Hub leaks a revocable device token and nothing
 * worth stealing.
 *
 * Usage:
 *   npx tsx scripts/pair-gateway.ts <pairing-code>
 *   npx tsx scripts/pair-gateway.ts --from-config    read the code from the gateway's own
 *                                                    config file on this machine
 *   npx tsx scripts/pair-gateway.ts --status
 *
 * Dev/ops tool. Not imported by the app.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ENV_FILE = path.join(process.cwd(), '.env.local');

/* The gateway's own configuration on the operator's machine, named by
   FORMA_AI_GATEWAY_CONFIG. Read in memory, used once, never written into this
   repo. */
const GATEWAY_CONFIG = process.env.FORMA_AI_GATEWAY_CONFIG || '';

const DEFAULT_ENDPOINT = process.env.FORMA_AI_GATEWAY_URL || '';

function readEnvFile(): Record<string, string> {
  if (!fs.existsSync(ENV_FILE)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) values[match[1]!] = match[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return values;
}

/* Rewrite in place rather than appending, so pairing twice does not leave two
   conflicting values with the later one silently winning. */
function writeEnvValues(updates: Record<string, string>): void {
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8').split('\n') : [];
  const remaining = { ...updates };

  const rewritten = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    const key = match?.[1];
    if (key && key in remaining) {
      const value = remaining[key]!;
      delete remaining[key];
      return `${key}=${value}`;
    }
    return line;
  });

  const added = Object.entries(remaining).map(([key, value]) => `${key}=${value}`);
  if (added.length) {
    if (rewritten.length && rewritten[rewritten.length - 1]!.trim() !== '') rewritten.push('');
    rewritten.push('# SYRIX AI gateway (written by scripts/pair-gateway.ts — device token, not a provider key)');
    rewritten.push(...added);
  }

  fs.writeFileSync(ENV_FILE, rewritten.join('\n'), 'utf8');
}

function codeFromConfig(): string {
  let contents: string;
  try {
    contents = fs.readFileSync(GATEWAY_CONFIG, 'utf8');
  } catch {
    throw new Error(
      `The gateway configuration was not found at ${GATEWAY_CONFIG}. ` +
        'Pass the pairing code as an argument instead, or set FORMA_AI_GATEWAY_CONFIG.'
    );
  }

  for (const line of contents.split('\n')) {
    const match = line.match(/^\s*(?:PAIRING_CODE|PAIR_CODE|SYRIX_PAIRING_CODE)\s*=\s*(.+)$/i);
    if (match) return match[1]!.trim().replace(/^["']|["']$/g, '');
  }

  throw new Error(`No pairing code found in ${GATEWAY_CONFIG}. Pass it as an argument instead.`);
}

async function pair(code: string): Promise<void> {
  const deviceId = `syrix-forma-${randomUUID().slice(0, 8)}`;

  const response = await fetch(DEFAULT_ENDPOINT + '/v1/device/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, deviceId, label: 'SYRIX Forma' })
  });

  const body = (await response.json().catch(() => ({}))) as { token?: string; deviceId?: string; error?: string };

  if (!response.ok || !body.token) {
    throw new Error(
      body.error === 'bad_code'
        ? 'That pairing code was not accepted.'
        : `The gateway refused to pair: ${body.error ?? response.status}`
    );
  }

  writeEnvValues({
    FORMA_AI_GATEWAY_URL: DEFAULT_ENDPOINT,
    FORMA_AI_GATEWAY_TOKEN: body.token,
    FORMA_AI_GATEWAY_DEVICE: body.deviceId ?? deviceId
  });

  /* The token itself is deliberately never printed. */
  console.log(`Paired. Device ${body.deviceId ?? deviceId} registered against ${DEFAULT_ENDPOINT}.`);
  console.log('Token written to .env.local (gitignored). The pairing code was not stored.');
  console.log('\nCheck it with:  npx tsx scripts/ai-probe.ts chain');
}

function status(): void {
  const env = { ...readEnvFile(), ...process.env } as Record<string, string>;
  const token = env.FORMA_AI_GATEWAY_TOKEN;
  console.log(`Endpoint: ${env.FORMA_AI_GATEWAY_URL || '(not set)'}`);
  console.log(`Device:   ${env.FORMA_AI_GATEWAY_DEVICE || '(not set)'}`);
  console.log(`Token:    ${token ? 'present' : 'not set'}`);
}

async function main(): Promise<void> {
  const argument = process.argv[2];

  if (!argument || argument === '--help') {
    console.log('Usage:');
    console.log('  npx tsx scripts/pair-gateway.ts <pairing-code>');
    console.log('  npx tsx scripts/pair-gateway.ts --from-config');
    console.log('  npx tsx scripts/pair-gateway.ts --status');
    return;
  }

  if (argument === '--status') return status();
  if (argument === '--from-config') return pair(codeFromConfig());
  return pair(argument.trim());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
