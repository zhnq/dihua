import { basename, extname } from 'node:path'
import type { ChatMessage, LineFormat, MessageKind, NestedSummary, ParseConfidence, Transcript, TranscriptCounts } from '@shared/types'

const TXT_CANDIDATES = ['聊天记录.txt', '聊天記錄.txt', 'chat history.txt']

/** 在解压得到的相对路径里找微信的 TXT：先按各语言候选名，再兜底「唯一的 .txt」，最后取最大的 .txt */
export function locateTranscript(relPaths: string[], sizes?: Map<string, number>): string | undefined {
  const txts = relPaths.filter((p) => extname(p).toLowerCase() === '.txt')
  if (txts.length === 0) return undefined
  const byName = txts.find((p) => TXT_CANDIDATES.includes(basename(p).toLowerCase()))
  if (byName) return byName
  if (txts.length === 1) return txts[0]
  if (sizes) return [...txts].sort((a, b) => (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0))[0]
  return txts[0]
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp'])
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv'])

export function classifyMedia(name: string): 'image' | 'video' | 'other' {
  const ext = extname(name).toLowerCase()
  if (IMAGE_EXT.has(ext)) return 'image'
  if (VIDEO_EXT.has(ext)) return 'video'
  return 'other'
}

/**
 * 时间写法：
 *  - 微信 Mac 4.1.13「转发到其他应用」实际导出：2026年9月7日 23:53（无秒）
 *  - 其他常见写法：2026-09-07 23:53:05 / 2026/9/7 23:53
 */
const TIME_CN = String.raw`\d{4}年\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?`
const TIME_ISO = String.raw`\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?`
const TIME = `(?<t>${TIME_CN}|${TIME_ISO})`
const TIME_LINE = new RegExp(`^${TIME}$`)
const TIME_FIRST = new RegExp(`^${TIME}\\s+(?<who>\\S.{0,80}?)\\s*[:：]?\\s*$`)
const NAME_FIRST = new RegExp(`^(?<who>\\S.{0,80}?)\\s+${TIME}\\s*$`)
const NAME_ONLY_TIME_NEXT = /^(?<who>\S.{0,80}?)[:：]\s*$/
/** 微信 4.1.13 真实格式：发言人单独一行，前面带间隔号「·」，下一行是时间 */
const SENDER_LINE = /^[·•・]?\s*(?<who>\S.{0,80}?)\s*$/

const MEDIA_PLACEHOLDER = /^\[(?<k>图片|圖片|视频|視頻|文件|檔案|Image|Photo|Video|File)\]\s*(?<name>.*)$/i
const OTHER_PLACEHOLDER: Array<[RegExp, MessageKind]> = [
  [/^\[(动画表情|動畫表情|表情|Sticker|Emoji)\]/i, 'sticker'],
  [/^\[(聊天记录|聊天記錄|Chat History)\]/i, 'nested'],
  [/^\[(语音通话|語音通話|视频通话|視頻通話|Voice Call|Video Call)\]/i, 'call'],
  [/^\[(语音|語音|Voice|Audio)\]/i, 'voice'],
  [/^\[(链接|連結|Link|位置|Location|名片|Contact Card|小程序|Mini Program|视频号[^\]]*|轉賬|转账|红包|紅包)\]/i, 'other'],
]
const FOOTER = /^(?:以上为分享的|以上為分享的|Above are)\s*(?<n>\d+)\s*(?:条聊天记录|條聊天記錄|messages?)/i

interface HeaderHit {
  format: Exclude<LineFormat, 'unknown'>
  time: string
  who: string
  /** 该行头占用的行数（block 格式为 2） */
  span: number
  indent: number
}

/** 微信用四个空格表示一层转发；同时兼容制表符和全角空格。 */
function indentation(line: string): number {
  let width = 0
  for (const ch of line) {
    if (ch === ' ') width += 1
    else if (ch === '\t') width += 4 - width % 4
    else if (ch === '\u3000') width += 2
    else break
  }
  return width
}

function stripIndent(line: string, width: number): string {
  let end = 0
  let removed = 0
  while (end < line.length) {
    const ch = line[end]
    const step = ch === ' ' ? 1 : ch === '\t' ? 4 - removed % 4 : ch === '\u3000' ? 2 : 0
    if (!step || removed + step > width) break
    removed += step
    end += 1
  }
  return line.slice(end)
}

function matchSingleLineHeader(line: string): HeaderHit | null {
  let m = TIME_FIRST.exec(line.trim())
  if (m?.groups) return { format: 'time-first', time: m.groups.t, who: m.groups.who.trim(), span: 1, indent: indentation(line) }
  m = NAME_FIRST.exec(line.trim())
  if (m?.groups) return { format: 'name-first', time: m.groups.t, who: m.groups.who.trim(), span: 1, indent: indentation(line) }
  return null
}

function matchBlockHeader(line: string, next: string | undefined): HeaderHit | null {
  if (next === undefined || !TIME_LINE.test(next.trim())) return null
  if (indentation(line) !== indentation(next)) return null
  const trimmed = line.trim()
  if (!trimmed || TIME_LINE.test(trimmed)) return null
  const m = SENDER_LINE.exec(trimmed)
  if (!m?.groups) return null
  const t = TIME_LINE.exec(next.trim())
  return { format: 'block', time: t!.groups!.t, who: m.groups.who.trim(), span: 2, indent: indentation(line) }
}

function matchHeader(lines: string[], i: number, format: LineFormat | 'any'): HeaderHit | null {
  if (format === 'block' || format === 'any') {
    const hit = matchBlockHeader(lines[i], lines[i + 1])
    if (hit) return hit
    if (format === 'block') return null
  }
  const single = matchSingleLineHeader(lines[i])
  if (!single) return null
  if (format === 'any' || single.format === format) return single
  return null
}

export function normalizeTime(t: string): string {
  const cn = /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t)
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t)
  const m = cn ?? iso
  if (!m) return t
  const [, y, mo, d, h, mi, s] = m
  const date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  if (!h) return date
  return `${date} ${h.padStart(2, '0')}:${mi}${s ? ':' + s : ''}`
}

function classifyBody(text: string, mediaIndex: Map<string, string>): { kind: MessageKind; mediaFile?: string } {
  const first = text.split('\n')[0]?.trim() ?? ''
  const media = MEDIA_PLACEHOLDER.exec(first)
  if (media?.groups) {
    const k = media.groups.k.toLowerCase()
    const kind: MessageKind = /图片|圖片|image|photo/.test(k) ? 'image' : /视频|視頻|video/.test(k) ? 'video' : 'file'
    const name = media.groups.name.trim()
    const key = name.replace(/\\/g, '/').toLowerCase()
    const hit = name ? (mediaIndex.get(key) ?? mediaIndex.get(basename(key))) : undefined
    return { kind, mediaFile: hit }
  }
  for (const [re, kind] of OTHER_PLACEHOLDER) if (re.test(first)) return { kind }
  return { kind: 'text' }
}

export interface ParseInput {
  text: string
  /** 解压得到的附件相对路径；同时支持仅传 basename 的旧调用 */
  mediaFiles: string[]
  fallbackTitle: string
  txtFileName?: string
}

export function parseTranscript(input: ParseInput): Transcript {
  return parseLevel(input, 0)
}

export const MAX_NESTED_DEPTH = 16

function parseLevel(input: ParseInput, depth: number): Transcript {
  const rawText = input.text.replace(/^﻿/, '')
  const lines = rawText.split(/\r\n|\r|\n/)
  const mediaIndex = new Map<string, string>()
  const byBase = new Map<string, string[]>()
  for (const f of input.mediaFiles) {
    const key = f.replace(/\\/g, '/').toLowerCase()
    mediaIndex.set(key, f)
    const name = basename(key)
    byBase.set(name, [...(byBase.get(name) ?? []), f])
  }
  // 同名附件无法仅凭 basename 判定，宁可保留占位符，也不关联到错误文件。
  for (const [name, paths] of byBase) if (paths.length === 1) mediaIndex.set(name, paths[0])

  // 1) 投票决定行头格式
  const votes: Record<Exclude<LineFormat, 'unknown'>, number> = { block: 0, 'time-first': 0, 'name-first': 0 }
  let baseIndent = Infinity
  for (let i = 0; i < lines.length; i++) {
    const hit = matchHeader(lines, i, 'any')
    if (hit) {
      if (hit.indent < baseIndent) {
        baseIndent = hit.indent
        votes.block = votes['time-first'] = votes['name-first'] = 0
      }
      if (hit.indent === baseIndent) votes[hit.format] += 1
      if (hit.span === 2) i += 1
    }
  }
  const ranked = (Object.entries(votes) as Array<[Exclude<LineFormat, 'unknown'>, number]>).sort((a, b) => b[1] - a[1])
  const format: LineFormat = ranked[0][1] === 0 ? 'unknown' : ranked[0][0]

  // 2) 逐行切分
  const messages: ChatMessage[] = []
  const preamble: string[] = []
  let declaredCount: number | undefined
  let current: { time?: string; who?: string; body: string[]; raw: string[] } | null = null
  let pendingWho: string | undefined

  const flush = () => {
    if (!current) return
    const text = current.body.map((line) => stripIndent(line, baseIndent)).join('\n').trim()
    const cls = classifyBody(text, mediaIndex)
    const message: ChatMessage = {
      index: messages.length,
      time: current.time,
      sender: current.who,
      kind: cls.kind,
      mediaFile: cls.mediaFile,
      text,
      raw: current.raw.join('\n'),
    }
    if (cls.kind === 'nested') {
      // 只从标记后的行递归解析，保留原缩进；更深层的头不能混入当前层。
      const marker = current.body.findIndex((line) => line.trim())
      const childText = current.body.slice(marker + 1).join('\n')
      if (depth >= MAX_NESTED_DEPTH) message.nestedStatus = 'depth-limit'
      else {
        const child = parseLevel({ ...input, text: childText }, depth + 1)
        if (child.format !== 'unknown' && child.messages.length) {
          message.children = child.messages
          message.nestedStatus = child.declaredCount !== undefined && child.declaredCount !== child.messages.length ? 'partial' : 'expanded'
          message.nestedPreamble = child.preamble
          message.nestedDeclaredCount = child.declaredCount
        } else message.nestedStatus = 'unavailable'
      }
    }
    messages.push(message)
    current = null
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const line = rawLine.trim()
    const footer = FOOTER.exec(line)
    if (footer?.groups && indentation(rawLine) === baseIndent) {
      declaredCount = Number(footer.groups.n)
      continue
    }
    const hit = format === 'unknown' ? null : matchHeader(lines, i, format)
    if (hit && hit.indent === baseIndent) {
      flush()
      const rawHeader = hit.span === 2 ? [rawLine, lines[i + 1]] : [rawLine]
      current = { time: normalizeTime(hit.time), who: hit.who, body: [], raw: rawHeader }
      pendingWho = undefined
      i += hit.span - 1
      continue
    }
    if (format === 'unknown') {
      const nameOnly = NAME_ONLY_TIME_NEXT.exec(line)
      if (nameOnly?.groups && !current) {
        pendingWho = nameOnly.groups.who.trim()
        continue
      }
      if (pendingWho) {
        flush()
        current = { who: pendingWho, body: [line], raw: [rawLine] }
        pendingWho = undefined
        continue
      }
    }
    if (current) {
      current.body.push(rawLine)
      current.raw.push(rawLine)
    } else if (line) {
      preamble.push(line)
    }
  }
  flush()

  // 3) 统计
  const counts: TranscriptCounts = { messages: messages.length, images: 0, videos: 0, files: 0, others: 0 }
  const nested: NestedSummary = { records: 0, messages: 0, unresolved: 0 }
  function count(list: ChatMessage[], inner: boolean): void {
    for (const m of list) {
      if (inner) nested.messages += 1
      if (m.kind === 'image') counts.images += 1
      else if (m.kind === 'video') counts.videos += 1
      else if (m.kind === 'file') counts.files += 1
      else if (m.kind !== 'text') counts.others += 1
      if (m.kind === 'nested') {
        nested.records += 1
        if (m.nestedStatus !== 'expanded') nested.unresolved += 1
      }
      if (m.children) count(m.children, true)
    }
  }
  count(messages, false)
  const times = messages.map((m) => m.time).filter((t): t is string => !!t)
  const timeRange = times.length ? { start: times[0], end: times[times.length - 1] } : undefined

  // 4) 置信度
  let parseConfidence: ParseConfidence
  if (format === 'unknown' || messages.length === 0) parseConfidence = 'low'
  else if (declaredCount !== undefined && declaredCount !== messages.length) parseConfidence = 'medium'
  else if (format === 'block') parseConfidence = preamble.length > 3 ? 'medium' : 'high'
  else {
    const nonEmpty = lines.filter((l) => l.trim()).length
    const ratio = messages.length / Math.max(1, nonEmpty)
    parseConfidence = ratio >= 0.25 ? 'high' : 'medium'
  }

  const title = deriveTitle(preamble, messages, input.fallbackTitle)
  return {
    title,
    messages,
    parseConfidence,
    format,
    timeRange,
    counts,
    rawText,
    txtFileName: input.txtFileName,
    declaredCount,
    preamble: preamble.join('\n') || undefined,
    nested,
  }
}

/** 有标题行就用标题行；微信 4.1.13 的导出没有标题，则用参与者拼一个 */
function deriveTitle(preamble: string[], messages: ChatMessage[], fallback: string): string {
  const first = preamble.find((l) => l.length <= 80)
  if (first) {
    const cleaned = first
      .replace(/^(与|和)?[「"“]?/, '')
      .replace(/[」"”]?的聊天记录$/, '')
      .replace(/[」"”]?的聊天記錄$/, '')
      .replace(/^Chat History (with|of)\s*/i, '')
      .trim()
    if (cleaned) return cleaned
  }
  const senders: string[] = []
  for (const m of messages) if (m.sender && !senders.includes(m.sender)) senders.push(m.sender)
  if (senders.length === 0) return fallback
  if (senders.length <= 3) return senders.join('、')
  return `${senders.slice(0, 2).join('、')} 等 ${senders.length} 人`
}
