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

import {
  AGENT_INSTALL_SCRIPT,
  buildTokenizedAgentInstallScript,
} from './agent-script'

const tempDirs: Array<string> = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('agent install script', () => {
  test('pins tokenized installers to the configured base URL', () => {
    const script = buildTokenizedAgentInstallScript({
      autoUpdate: true,
      baseUrl: 'https://devpush.example',
      token: `dps_${'a'.repeat(43)}`,
      traefikEmail: 'ops@devpush.example',
    })

    expect(script).toContain(
      "export DEVPUSH_BASE_URL='https://devpush.example'",
    )
    expect(script).toContain(
      `export DEVPUSH_AGENT_TOKEN='dps_${'a'.repeat(43)}'`,
    )
    expect(script).toContain("export DEVPUSH_AGENT_AUTO_UPDATE='true'")
    expect(script).toContain(
      "export DEVPUSH_TRAEFIK_EMAIL='ops@devpush.example'",
    )
  })

  test.each(['x";echo injected;"', 'dps_token\nINJECTED=1', 'dps_short'])(
    'rejects malformed enrollment token %s before generating an installer',
    (token) => {
      expect(() =>
        buildTokenizedAgentInstallScript({
          autoUpdate: true,
          baseUrl: 'https://devpush.example',
          token,
        }),
      ).toThrow('Invalid agent enrollment token.')
    },
  )

  test('update helper reads control-plane data without executing the environment file', () => {
    expect(AGENT_INSTALL_SCRIPT).not.toContain('source /etc/devpush/agent.env')
    expect(AGENT_INSTALL_SCRIPT).toContain("sed -n 's/^DEVPUSH_BASE_URL=")
  })

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
  *"/api/install/agent/binary?os=linux&arch=arm64"*)
    printf '#!/usr/bin/env sh\\necho devpush-agent-test\\n' > "$out"
    ;;
  *"/api/install/agent/checksum?os=linux&arch=arm64"*)
    binary="$(dirname "$out")/devpush-agent-linux-arm64"
    printf '%s  devpush-agent-linux-arm64\\n' "$(sha256sum "$binary" | cut -d' ' -f1)" > "$out"
    ;;
  *)
    echo "unexpected binary URL: $url" >&2
    exit 1
    ;;
esac
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

    const installEnv = {
      ...process.env,
      DEVPUSH_AGENT_TOKEN: 'dps_test_token',
      DEVPUSH_AGENT_AUTO_UPDATE: 'true',
      DEVPUSH_INSTALL_ROOT: root,
      DEVPUSH_BASE_URL: 'https://devpush.example',
      DEVPUSH_TRAEFIK_EMAIL: 'ops@devpush.example',
      PATH: `${bin}:${process.env.PATH ?? ''}`,
    }
    const output = execFileSync('bash', [script, '--address', '192.168.64.7'], {
      env: installEnv,
      encoding: 'utf8',
    })

    expect(output).toContain('██╗██████╗ ███████╗')
    expect(output).toContain('Installation summary')
    expect(readFileSync(join(root, 'etc/devpush/agent.env'), 'utf8')).toContain(
      'DEVPUSH_ROUTING_ADDRESS="192.168.64.7"',
    )
    const reinstallEnv = { ...installEnv }
    delete (reinstallEnv as Record<string, unknown>).DEVPUSH_TRAEFIK_EMAIL
    execFileSync('bash', [script], { env: reinstallEnv, encoding: 'utf8' })
    expect(readFileSync(join(root, 'etc/devpush/agent.env'), 'utf8')).toContain(
      'DEVPUSH_TRAEFIK_EMAIL="ops@devpush.example"',
    )
    expect(output).toContain('Verifying agent checksum')
    expect(output).toContain('devpush agent installation complete')
    expect(output).toContain('devpush-agent-test')
    expect(output).toContain('Useful commands')
    expect(output).toContain('Next steps')
    expect(output).toContain('Install log')

    expect(
      readFileSync(join(root, 'var/log/devpush-agent/latest.log'), 'utf8'),
    ).toContain('devpush agent installation complete')

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
    execFileSync('bash', [script], { env: installEnv })
    expect(readFileSync(join(root, 'etc/devpush/agent.env'), 'utf8')).toContain(
      'DEVPUSH_ROUTING_ADDRESS="192.168.64.7"',
    )
    execFileSync('bash', [script, '--address', 'auto'], { env: installEnv })
    expect(readFileSync(join(root, 'etc/devpush/agent.env'), 'utf8')).toContain(
      'DEVPUSH_ROUTING_ADDRESS=""',
    )
  }, 15_000)

  test('fails without a base URL', () => {
    const tempDir = createTempDir()
    const bin = join(tempDir, 'bin')
    const script = join(tempDir, 'install.sh')

    mkdirSync(bin)
    writeFileSync(script, AGENT_INSTALL_SCRIPT, { mode: 0o755 })
    writeFakeCommand(bin, 'id', '#!/usr/bin/env bash\necho 0\n')

    expect(() =>
      execFileSync('bash', [script, '--address', '192.168.64.7'], {
        env: {
          ...process.env,
          DEVPUSH_AGENT_TOKEN: 'dps_test_token',
          PATH: `${bin}:${process.env.PATH ?? ''}`,
        },
        stdio: 'pipe',
      }),
    ).toThrow()
  })

  test('rejects an agent binary with a mismatched checksum', () => {
    const tempDir = createTempDir()
    const root = join(tempDir, 'root')
    const bin = join(tempDir, 'bin')
    const script = join(tempDir, 'install.sh')

    mkdirSync(root)
    mkdirSync(bin)
    writeFileSync(script, AGENT_INSTALL_SCRIPT, { mode: 0o755 })
    writeFakeCommand(
      bin,
      'id',
      '#!/usr/bin/env bash\nif [ "${1:-}" = "-u" ] && [ -z "${2:-}" ]; then echo 0; else exit 1; fi\n',
    )
    writeFakeCommand(
      bin,
      'curl',
      `#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
while [ "$#" -gt 0 ]; do
  if [ "$1" != "-fsSL" ] && [ "$1" != "-o" ] && [ -z "$url" ]; then url="$1"; fi
  if [ "$1" = "-o" ]; then shift; out="$1"; fi
  shift || true
done
case "$url" in
  *"/binary?"*) printf '#!/usr/bin/env sh\necho tampered\n' > "$out" ;;
  *"/checksum?"*) printf '%064d  devpush-agent-linux-amd64\n' 0 > "$out" ;;
  *) exit 1 ;;
esac
`,
    )
    writeFakeCommand(bin, 'git', '#!/usr/bin/env bash\nexit 0\n')
    writeFakeCommand(
      bin,
      'uname',
      '#!/usr/bin/env bash\nif [ "${1:-}" = "-s" ]; then echo Linux; else echo x86_64; fi\n',
    )
    writeFakeCommand(
      bin,
      'docker',
      '#!/usr/bin/env bash\nif [ "${1:-}" = "compose" ]; then exit 0; fi\nexit 0\n',
    )
    writeFakeCommand(bin, 'getent', '#!/usr/bin/env bash\nexit 1\n')
    writeFakeCommand(bin, 'systemctl', '#!/usr/bin/env bash\nexit 0\n')

    expect(() =>
      execFileSync('bash', [script, '--address', '192.168.64.7'], {
        env: {
          ...process.env,
          DEVPUSH_AGENT_TOKEN: 'dps_test_token',
          DEVPUSH_INSTALL_ROOT: root,
          DEVPUSH_BASE_URL: 'https://devpush.example',
          PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        },
        stdio: 'pipe',
      }),
    ).toThrow()
    expect(() =>
      readFileSync(join(root, 'usr/local/bin/devpush-agent')),
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
  *"/api/install/agent/binary?os=linux&arch=amd64"*)
    printf '#!/usr/bin/env sh\\necho devpush-agent-test\\n' > "$out"
    ;;
  *"/api/install/agent/checksum?os=linux&arch=amd64"*)
    binary="$(dirname "$out")/devpush-agent-linux-amd64"
    printf '%s  devpush-agent-linux-amd64\\n' "$(sha256sum "$binary" | cut -d' ' -f1)" > "$out"
    ;;
  *) exit 1 ;;
esac
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

    execFileSync('bash', [script, '--address', '192.168.64.7'], {
      env: {
        ...process.env,
        DEVPUSH_AGENT_TOKEN: 'dps_test_token',
        DEVPUSH_INSTALL_ROOT: root,
        DEVPUSH_BASE_URL: 'https://devpush.example',
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
