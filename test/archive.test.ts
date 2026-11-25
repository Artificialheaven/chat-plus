import './setup.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as db from '../src/services/chat/db.js'
import { BackupError } from '../src/services/chat/history/errors.js'
import { importArchive } from '../src/services/chat/history/importArchive.js'
import { inspectArchive } from '../src/services/chat/history/inspectArchive.js'
import { archiveFiles, dirOf, zipOf } from './fixtures.js'

const sessionIdsAfterCommit = async (): Promise<string[]> =>
  (await db.commitStaging()).map((summary) => summary.id)

test('探查只读目录与索引，不解压会话正文', async () => {
  // 会话正文是非法 JSON：能列出会话就说明探查阶段没有解压它
  const source = zipOf(archiveFiles({ corrupt: 'a2' }))
  const inspection = await inspectArchive(source)
  assert.deepEqual(
    inspection.sessions.map((session) => session.id),
    ['a1', 'a2']
  )
  assert.equal(inspection.sessions[0]?.title, '标题 a1')
  assert.equal(inspection.sessions[0]?.messageCount, 2)
  assert.ok(inspection.sessions[0]!.bytes > 0)
})

test('全量导入写入全部会话', async () => {
  await db.clearStaging()
  await importArchive(zipOf(archiveFiles()))
  assert.deepEqual(await sessionIdsAfterCommit(), ['a1', 'a2'])
})

test('选择性导入只写入选中的会话', async () => {
  await db.clearStaging()
  await importArchive(zipOf(archiveFiles()), { sessionIds: new Set(['a2']) })
  assert.deepEqual(await sessionIdsAfterCommit(), ['a2'])
})

test('空选择不写任何会话', async () => {
  await db.clearStaging()
  await importArchive(zipOf(archiveFiles()), { sessionIds: new Set() })
  assert.deepEqual(await sessionIdsAfterCommit(), [])
})

test('目录来源与 ZIP 结果一致', async () => {
  const files = archiveFiles()
  await db.clearStaging()
  await importArchive(zipOf(files))
  const fromZip = await sessionIdsAfterCommit()

  await db.clearStaging()
  await importArchive(dirOf(files))
  const fromDir = await sessionIdsAfterCommit()

  assert.deepEqual(fromZip, ['a1', 'a2'])
  assert.deepEqual(fromDir, fromZip)
})

test('目录来源不要求 manifest 位于首个条目', async () => {
  // 目录没有物理顺序，manifest 放最后也能导入
  const inspection = await inspectArchive(dirOf(archiveFiles({ manifestLast: true })))
  assert.equal(inspection.sessions.length, 2)
})

test('ZIP 来源要求 manifest 是首个条目', async () => {
  await assert.rejects(
    () => inspectArchive(zipOf(archiveFiles({ manifestLast: true }))),
    (error: unknown) => error instanceof BackupError && error.key === 'backupUnrecognized'
  )
})

test('选择不存在的会话被拒绝', async () => {
  await db.clearStaging()
  await assert.rejects(
    () => importArchive(zipOf(archiveFiles()), { sessionIds: new Set(['nope']) }),
    (error: unknown) => error instanceof BackupError && error.key === 'backupIncomplete'
  )
})

test('索引缺少会话文件时拒绝导入', async () => {
  await db.clearStaging()
  await assert.rejects(
    () => importArchive(zipOf(archiveFiles({ indexIds: ['a1'] }))),
    (error: unknown) => error instanceof BackupError && error.key === 'backupIncomplete'
  )
})

test('目录里存在索引未列出的会话时拒绝导入', async () => {
  await db.clearStaging()
  await assert.rejects(
    () => importArchive(zipOf(archiveFiles({ extraSession: 'zz' }))),
    (error: unknown) => error instanceof BackupError && error.key === 'backupIncomplete'
  )
})

test('会话正文损坏时报 JSON 错误', async () => {
  await db.clearStaging()
  await assert.rejects(
    () => importArchive(zipOf(archiveFiles({ corrupt: 'a2' }))),
    (error: unknown) => error instanceof BackupError && error.key === 'backupInvalidJson'
  )
})

test('未选中的损坏会话不影响导入', async () => {
  await db.clearStaging()
  await importArchive(zipOf(archiveFiles({ corrupt: 'a2' })), { sessionIds: new Set(['a1']) })
  assert.deepEqual(await sessionIdsAfterCommit(), ['a1'])
})
