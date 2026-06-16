import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {getLocalHttpsConfig} from '../../vite.local-https'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, {recursive: true, force: true})
  }
})

describe('getLocalHttpsConfig', () => {
  it('generates a localhost certificate when one is missing', () => {
    const certDir = mkdtempSync(join(tmpdir(), 'penge-https-'))
    tempDirs.push(certDir)
    const execFileSync = vi.fn(() => {
      writeFileSync(join(certDir, 'localhost-key.pem'), 'key')
      writeFileSync(join(certDir, 'localhost-cert.pem'), 'cert')
      return Buffer.from('')
    })

    const config = getLocalHttpsConfig({certDir, execFileSync})

    expect(config.key.toString()).toBe('key')
    expect(config.cert.toString()).toBe('cert')
    expect(execFileSync).toHaveBeenCalledWith(
      'openssl',
      expect.arrayContaining([
        '-x509',
        '-nodes',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ]),
      {stdio: 'ignore'},
    )
  })
})
