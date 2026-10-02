import { describe, expect, it } from 'vitest'
import { grade } from '../src/grade.js'
import { extractExports } from '../src/symbols.js'
import { fakeProject } from './helpers.js'

const context = fakeProject()

function check(code: string) {
  const result = grade([{ key: 'sample', code }], context).get('sample')
  if (!result) throw new Error('no result')
  return result
}

describe('grade', () => {
  it('passes correct usage', () => {
    const result = check(`
      import { connect, utils, Level } from 'fakelib'
      const client = connect('db://local', { retries: 2 })
      const rows = await client.query('select 1')
      console.log(rows[0]?.id, utils.slugify('Hi'), Level.Info)
      client.close()
    `)
    expect(result.issues).toEqual([])
  })

  it('flags exports that do not exist', () => {
    const [issue] = check(`import { createClient } from 'fakelib'\ncreateClient()`).issues
    expect(issue).toMatchObject({ kind: 'missing-export', symbol: 'fakelib.createClient' })
  })

  it('suggests the closest real export', () => {
    const [issue] = check(`import { conect } from 'fakelib'`).issues
    expect(issue).toMatchObject({ symbol: 'fakelib.conect', suggestion: 'connect' })
  })

  it('flags members that do not exist on package types', () => {
    const { issues } = check(`
      import { Client } from 'fakelib'
      const client = new Client('db://local')
      await client.execute('select 1')
      await client.qeury('select 1')
    `)
    expect(issues).toEqual([
      expect.objectContaining({ kind: 'missing-member', symbol: 'Client.execute' }),
      expect.objectContaining({
        kind: 'missing-member',
        symbol: 'Client.qeury',
        suggestion: 'query',
      }),
    ])
  })

  it('flags members missing on namespace imports', () => {
    const [issue] = check(`import { utils } from 'fakelib'\nutils.slugiffy('a')`).issues
    expect(issue).toMatchObject({ symbol: 'utils.slugiffy', suggestion: 'slugify' })
  })

  it('labels `import * as` namespaces with the package name', () => {
    const [issue] = check(`import * as lib from 'fakelib'\nlib.disconnect()`).issues
    expect(issue).toMatchObject({ kind: 'missing-member', symbol: 'fakelib.disconnect' })
  })

  it('flags wrong call signatures', () => {
    const [issue] = check(`import { connect } from 'fakelib'\nconnect()`).issues
    expect(issue).toMatchObject({ kind: 'wrong-signature', symbol: 'connect' })
  })

  it('flags method calls with wrong arguments', () => {
    const [issue] = check(`
      import { connect } from 'fakelib'
      connect('x').query(42)
    `).issues
    expect(issue).toMatchObject({ kind: 'wrong-signature', symbol: 'Client.query' })
  })

  it('flags invented option names', () => {
    const [issue] = check(`import { connect } from 'fakelib'\nconnect('x', { retry: 3 })`).issues
    expect(issue).toMatchObject({
      kind: 'missing-member',
      symbol: 'Options.retry',
      suggestion: 'retries',
    })
  })

  it('flags subpaths that do not exist', () => {
    const [issue] = check(`import { serve } from 'fakelib/server'`).issues
    expect(issue).toMatchObject({ kind: 'missing-module', symbol: 'fakelib/server' })
  })

  it('ignores errors unrelated to the package', () => {
    const result = check(`
      import { VERSION } from 'fakelib'
      const n: number = 'not a number'
      console.log(VERSION, n)
    `)
    expect(result.issues).toEqual([])
    expect(result.otherErrors).toBe(1)
  })

  it('grades many snippets in one program', () => {
    const results = grade(
      [
        { key: 'a', code: `import { connect } from 'fakelib'\nconnect('x')` },
        { key: 'b', code: `import { nope } from 'fakelib'` },
      ],
      context,
    )
    expect(results.get('a')?.issues).toEqual([])
    expect(results.get('b')?.issues).toHaveLength(1)
  })
})

describe('extractExports', () => {
  it('lists value exports and skips types, deprecated and private ones', () => {
    const names = extractExports(context.projectRoot, ['fakelib'])
      .map((s) => `${s.kind}:${s.name}`)
      .sort()
    expect(names).toEqual([
      'class:Client',
      'enum:Level',
      'function:connect',
      'namespace:utils',
      'variable:VERSION',
    ])
  })
})
