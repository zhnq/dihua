import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { JobSummary } from '../src/shared/types'
import { attachmentFile, readJobContent } from '../src/main/jobContent'
import { parseTranscript } from '../src/main/parse'

const roots: string[] = []
function batch(): JobSummary {
  const inboxDir = mkdtempSync(join(tmpdir(), 'dihua-preview-'))
  roots.push(inboxDir)
  mkdirSync(join(inboxDir, '媒体'))
  mkdirSync(join(inboxDir, '文件'))
  return { inboxDir } as JobSummary
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

describe('bounded on-demand content preview', () => {
  it('preserves nesting depth, omits repeated raw text, and provides real attachment bytes', () => {
    const job = batch()
    const transcript = parseTranscript({ text: '·外层\n2026年10月29日 00:10\n[聊天记录]\n\n    ·内层\n    2026年10月29日 00:09\n    正文\n', mediaFiles: [], fallbackTitle: '测试' })
    transcript.messages[0].nestedPreamble = '较长的嵌套原文'.repeat(2000)
    writeFileSync(join(job.inboxDir, 'transcript.json'), JSON.stringify(transcript))
    writeFileSync(join(job.inboxDir, '媒体/test.png'), Buffer.from('真实缩略图数据'))
    writeFileSync(join(job.inboxDir, '文件/note.txt'), '真实附件内容')
    const result = readJobContent(job)
    expect(result.messages.map((m) => m.depth)).toEqual([0, 1])
    expect(result.messages[0].text).toMatch(/^\[聊天记录\]\n较长的嵌套原文/)
    expect(result.messages[0].text).toHaveLength(4000)
    expect(result.messages[1].text).toBe('正文')
    expect(result.truncated).toBe(true)
    expect(result.messages.every((m) => !('children' in m) && m.raw === '')).toBe(true)
    expect(result.messages[0]).not.toHaveProperty('nestedPreamble')
    expect(Buffer.from(result.attachments[0].thumbnail!.split(',')[1], 'base64')).toEqual(readFileSync(join(job.inboxDir, '媒体/test.png')))
    expect(result.attachments[1]).toMatchObject({ path: '文件/note.txt', kind: 'file' })
  })

  it('rejects traversal, arbitrary files, and symlinks outside the batch', () => {
    const job = batch()
    writeFileSync(join(job.inboxDir, 'secret.txt'), '不应读取')
    symlinkSync(join(job.inboxDir, 'secret.txt'), join(job.inboxDir, '媒体/link.png'))
    for (const path of ['../secret.txt', '/etc/passwd', '媒体/../secret.txt', '原始/secret.txt', '媒体/link.png']) expect(() => attachmentFile(job, path)).toThrow()
  })

  it('bounds preview size without altering the complete stored transcript', () => {
    const job = batch()
    const messages = Array.from({ length: 250 }, (_, index) => ({ index, text: '正文', kind: 'text', raw: '原文' }))
    writeFileSync(join(job.inboxDir, 'transcript.json'), JSON.stringify({ messages }))
    const result = readJobContent(job)
    expect(result.messages).toHaveLength(200)
    expect(result.truncated).toBe(true)
    expect(JSON.parse(readFileSync(join(job.inboxDir, 'transcript.json'), 'utf8')).messages).toHaveLength(250)
  })

  it('supports old batches with Markdown only and avoids arbitrary active-image formats', () => {
    const job = batch()
    writeFileSync(join(job.inboxDir, 'transcript.md'), '# 旧批次\n正文')
    writeFileSync(join(job.inboxDir, '媒体/active.svg'), '<svg onload="alert(1)"/>')
    const result = readJobContent(job)
    expect(result.messages[0].text).toContain('旧批次')
    expect(result.attachments[0].thumbnail).toBeUndefined()
  })
})
