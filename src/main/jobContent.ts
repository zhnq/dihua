import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, extname, join, sep } from 'node:path'
import type { ChatMessage, ContentAttachment, JobContent, JobSummary, Transcript } from '@shared/types'
import { classifyMedia } from './parse'

/** 预览只允许读取本批附件；不接受任意本地路径或符号链接。 */
export function attachmentFile(job: JobSummary, path: string): string {
  if (typeof path !== 'string' || !/^(媒体|文件)\/[^/\\]+$/.test(path)) throw new Error('无效的附件路径')
  const file = join(job.inboxDir, path)
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('附件不可用')
  if (!realpathSync(file).startsWith(realpathSync(job.inboxDir) + sep)) throw new Error('附件不在本批记录中')
  return file
}

export function readJobContent(job: JobSummary): JobContent {
  const out: JobContent = { messages: [], attachments: [], truncated: false }
  const structured = join(job.inboxDir, 'transcript.json')
  if (existsSync(structured)) {
    const transcript = JSON.parse(readFileSync(structured, 'utf8')) as Transcript
    const visit = (messages: ChatMessage[], depth: number): void => {
      for (const message of messages) {
        if (out.messages.length >= 200) { out.truncated = true; return }
        const { children, raw: _raw, nestedPreamble: _preamble, text, ...rest } = message
        const body = message.kind === 'nested' ? [text.split('\n')[0], message.nestedPreamble].filter(Boolean).join('\n') : text
        out.messages.push({ ...rest, raw: '', text: body.slice(0, 4000), depth })
        if (body.length > 4000) out.truncated = true
        if (children) visit(children, depth + 1)
      }
    }
    visit(transcript.messages, 0)
  } else {
    const text = readFileSync(join(job.inboxDir, 'transcript.md'), 'utf8')
    out.messages.push({ index: 0, kind: 'text', text: text.slice(0, 40000), raw: '', depth: 0 })
    out.truncated = text.length > 40000
  }

  const mimes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
  let thumbnails = 0
  for (const dir of ['媒体', '文件']) {
    const folder = join(job.inboxDir, dir)
    if (!existsSync(folder)) continue
    for (const name of readdirSync(folder).sort()) {
      if (name.startsWith('.') || name.endsWith('.thumb.png')) continue
      if (out.attachments.length >= 200) { out.truncated = true; break }
      try {
        const path = `${dir}/${name}`
        const file = attachmentFile(job, path)
        const bytes = statSync(file).size
        const kind = classifyMedia(name)
        const item: ContentAttachment = { path, name: basename(name), kind: kind === 'other' ? 'file' : kind, bytes }
        const mime = mimes[extname(name).toLowerCase()]
        if (mime && bytes <= 2 * 1024 * 1024 && thumbnails < 4) {
          item.thumbnail = `data:${mime};base64,${readFileSync(file).toString('base64')}`
          thumbnails += 1
        }
        out.attachments.push(item)
      } catch { /* 缺失、符号链接或越界附件不进入预览 */ }
    }
  }
  return out
}
