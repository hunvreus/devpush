import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { AGENT_INSTALL_SCRIPT } from './agent-script'

const tempDirs: Array<string> = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('agent install script', () => {
  test('writes staged agent files and starts the service', () => {
    const tempDir = createTempDir()
    const root = join(tempDir, 'root')
    const bin = join(tempDir, 'bin')
    const script = join(tempDir, 'install.sh')
    const systemctlLog = join(tempDir, 'systemctl.log')

    mkdirSync(root)
    mkdirSync(bin)
    writeFileSync(script, AGENT_INSTALL_SCRIPT, { mode: 0o755 })
    writeFakeCommand(
      bin,
      'id',
      `#!/usr/bin/env bash
if [ "\${1:-}" = "-u" ] && [ -z "\${2:-}" ]; then
  echo 0
  exit 0
fi
exit 1
`,
    )
    writeFakeCommand(
      bin,
      'curl',
      `#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
while [ "$#" -gt 0 ]; do
  if [ "$1" != "-fsSL" ] && [ "$1" != "-o" ] && [ -z "$url" ]; then
    url="$1"
  fi
  if [ "$1" = "-o" ]; then
    shift
    out="$1"
  fi
  shift || true
done
if [ -z "$out" ]; then
  exit 0
fi
case "$url" in
  *"/api/install/agent/binary?os=linux&arch=arm64"*) ;;
  *)
    echo "unexpected binary URL: $url" >&2
    exit 1
    ;;
esac
printf '#!/usr/bin/env sh\\necho devpush-agent\\n' > "$out"
`,
    )
    writeFakeCommand(bin, 'git', '#!/usr/bin/env bash\nexit 0\n')
    writeFakeCommand(
      bin,
      'uname',
      `#!/usr/bin/env bash
if [ "\${1:-}" = "-s" ]; then
  echo Linux
elif [ "\${1:-}" = "-m" ]; then
  echo aarch64
else
  exit 1
fi
`,
    )
    writeFakeCommand(
      bin,
      'docker',
      `#!/usr/bin/env bash
if [ "\${1:-}" = "compose" ] && [ "\${2:-}" = "version" ]; then
  exit 0
fi
exit 0
`,
    )
    writeFakeCommand(bin, 'getent', '#!/usr/bin/env bash\nexit 1\n')
    writeFakeCommand(
      bin,
      'systemctl',
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${systemctlLog}"
exit 0
`,
    )

    execFileSync('bash', [script], {
      env: {
        ...process.env,
        DEVPUSH_AGENT_TOKEN: 'dps_test_token',
        DEVPUSH_AGENT_AUTO_UPDATE: 'true',
        DEVPUSH_INSTALL_ROOT: root,
        DEVPUSH_SERVER_URL: 'https://devpush.example',
        DEVPUSH_TRAEFIK_EMAIL: 'ops@devpush.example',
        PATH: `${bin}:${process.env.PATH ?? ''}`,
      },
      stdio: 'pipe',
    })

    expect(readFileSync(join(root, 'etc/devpush/agent.env'), 'utf8')).toContain(
      'DEVPUSH_AGENT_TOKEN="dps_test_token"',
    )
    expect(readFileSync(join(root, 'etc/devpush/agent.env'), 'utf8')).toContain(
      `DEVPUSH_STATE_DIR="${root}/var/lib/devpush-agent"`,
    )
    expect(readFileSync(join(root, 'etc/devpush/agent.env'), 'utf8')).toContain(
      'DEVPUSH_TRAEFIK_EMAIL="ops@devpush.example"',
    )
    expect(
      readFileSync(
        join(root, 'etc/systemd/system/devpush-agent.service'),
        'utf8',
      ),
    ).toContain(`ExecStart=${root}/usr/local/bin/devpush-agent`)
    expect(
      readFileSync(
        join(root, 'etc/systemd/system/devpush-agent.service'),
        'utf8',
      ),
    ).toContain(`EnvironmentFile=${root}/etc/devpush/agent.env`)
    expect(
      readFileSync(join(root, 'usr/local/bin/devpush-agent'), 'utf8'),
    ).toContain('devpush-agent')
    expect(readFileSync(systemctlLog, 'utf8')).toContain('enable devpush-agent')
    expect(readFileSync(systemctlLog, 'utf8')).toContain(
      'restart devpush-agent',
    )
    expect(
      readFileSync(join(root, 'usr/local/lib/devpush/update-agent'), 'utf8'),
    ).toContain('/checksum?os=')
    expect(
      readFileSync(
        join(root, 'etc/systemd/system/devpush-agent-update.timer'),
        'utf8',
      ),
    ).toContain('OnCalendar=daily')
    expect(readFileSync(systemctlLog, 'utf8')).toContain(
      'enable --now devpush-agent-update.timer',
    )
  })

  test('fails without a server URL', () => {
    const tempDir = createTempDir()
    const bin = join(tempDir, 'bin')
    const script = join(tempDir, 'install.sh')

    mkdirSync(bin)
    writeFileSync(script, AGENT_INSTALL_SCRIPT, { mode: 0o755 })
    writeFakeCommand(bin, 'id', '#!/usr/bin/env bash\necho 0\n')

    expect(() =>
      execFileSync('bash', [script], {
        env: {
          ...process.env,
          DEVPUSH_AGENT_TOKEN: 'dps_test_token',
          PATH: `${bin}:${process.env.PATH ?? ''}`,
        },
        stdio: 'pipe',
      }),
    ).toThrow()
  })

  test('installs Docker Compose plugin on apt hosts when missing', () => {
    const tempDir = createTempDir()
    const root = join(tempDir, 'root')
    const bin = join(tempDir, 'bin')
    const script = join(tempDir, 'install.sh')
    const aptLog = join(tempDir, 'apt.log')
    const stateDir = join(tempDir, 'state')

    mkdirSync(root)
    mkdirSync(bin)
    mkdirSync(stateDir)
    writeFileSync(join(stateDir, 'compose-installed'), '')
    rmSync(join(stateDir, 'compose-installed'), { force: true })
    writeFileSync(script, AGENT_INSTALL_SCRIPT, { mode: 0o755 })
    writeFakeCommand(
      bin,
      'id',
      `#!/usr/bin/env bash
if [ "\${1:-}" = "-u" ] && [ -z "\${2:-}" ]; then
  echo 0
  exit 0
fi
exit 1
`,
    )
    writeFakeCommand(
      bin,
      'curl',
      `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    out="$1"
  fi
  shift || true
done
if [ -z "$out" ]; then
  exit 0
fi
printf '#!/usr/bin/env sh\\necho devpush-agent\\n' > "$out"
`,
    )
    writeFakeCommand(bin, 'git', '#!/usr/bin/env bash\nexit 0\n')
    writeFakeCommand(
      bin,
      'uname',
      `#!/usr/bin/env bash
if [ "\${1:-}" = "-s" ]; then
  echo Linux
elif [ "\${1:-}" = "-m" ]; then
  echo x86_64
else
  exit 1
fi
`,
    )
    writeFakeCommand(
      bin,
      'docker',
      `#!/usr/bin/env bash
if [ "\${1:-}" = "compose" ] && [ "\${2:-}" = "version" ]; then
  test -f "${stateDir}/compose-installed"
  exit $?
fi
exit 0
`,
    )
    writeFakeCommand(bin, 'getent', '#!/usr/bin/env bash\nexit 1\n')
    writeFakeCommand(
      bin,
      'apt-get',
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${aptLog}"
if [ "\${1:-}" = "install" ]; then
  touch "${stateDir}/compose-installed"
fi
exit 0
`,
    )
    writeFakeCommand(bin, 'systemctl', '#!/usr/bin/env bash\nexit 0\n')

    execFileSync('bash', [script], {
      env: {
        ...process.env,
        DEVPUSH_AGENT_TOKEN: 'dps_test_token',
        DEVPUSH_INSTALL_ROOT: root,
        DEVPUSH_SERVER_URL: 'https://devpush.example',
        PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      },
      stdio: 'pipe',
    })

    expect(readFileSync(aptLog, 'utf8')).toContain(
      'install -y docker-compose-plugin',
    )
  })
})

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'devpush-installer-'))
  tempDirs.push(dir)

  return dir
}

function writeFakeCommand(dir: string, name: string, content: string) {
  writeFileSync(join(dir, name), content, { mode: 0o755 })
}
