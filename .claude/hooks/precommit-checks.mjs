// PreToolUse hook (Bash): block `git commit` unless project checks are green.
// Exit 2 = block, stderr is shown to the agent.
import { spawnSync } from 'node:child_process';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let command = '';
try {
  command = JSON.parse(raw)?.tool_input?.command ?? '';
} catch {
  process.exit(0);
}

if (!/\bgit\s+(?:-\S+\s+)*commit\b/.test(command)) process.exit(0);

const checks = [
  'npm run typecheck',
  'npx tsc -p tsconfig.app.json --noEmit',
  'npx tsc -p tsconfig.spec.json --noEmit',
  'npx ng test --watch=false',
];

for (const cmd of checks) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) {
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').slice(-60).join('\n');
    process.stderr.write(`Commit blocked: \`${cmd}\` failed. Fix it, do not skip.\n${out}\n`);
    process.exit(2);
  }
}
process.exit(0);
