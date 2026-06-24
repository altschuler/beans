import {execFileSync as defaultExecFileSync} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'

type ExecFileSync = (file: string, args: readonly string[], options: {stdio: 'ignore'}) => unknown

export type LocalHttpsConfigOptions = {
  certDir?: string
  execFileSync?: ExecFileSync
}

export function getLocalHttpsConfig(options: LocalHttpsConfigOptions = {}) {
  const certDir = options.certDir ?? '.cert'
  const keyPath = join(certDir, 'localhost-key.pem')
  const certPath = join(certDir, 'localhost-cert.pem')

  if (!existsSync(keyPath) || !existsSync(certPath)) {
    mkdirSync(certDir, {recursive: true})
    const execFileSync: ExecFileSync = options.execFileSync ?? defaultExecFileSync
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '365',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      {stdio: 'ignore'},
    )
  }

  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  }
}
