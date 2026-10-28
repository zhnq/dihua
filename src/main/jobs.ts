import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { clipboard, shell } from 'electron'
import type { ChatMessage, DeliverOptions, DeliverResult, HistoryStats, JobDetail, JobSummary } from '@shared/types'
import { extractZip, isZipFile } from './extract'
import { buildHandoffPrompt, normalizeDeliveryNote } from './handoff'
import { locateTranscript, parseTranscript } from './parse'
import { buildWorkspace, ensureWorkspaceRoot } from './workspace'
import { getJob, getSettings, listHistory, removeJob, replaceHistory, updateSettings, upsertJob } from './store'
import { planAttachments } from './targets/attachments'
import { getTarget } from './targets/registry'
import type { Target } from './targets/types'
import { incomingDir, tmpDir } from './paths'
import log from './log'
import { copyBatchToThread, existingThreadPrompt, getCodexThread, queueCodexMessage } from './codex'

export type JobSource = JobSummary['source']

export interface ImportOptions {
  /** 来源是我们自己的 Share Extension 临时目录时，复制完就删掉 */
  removeSourceAfterCopy?: boolean
}

/** 接收一个 zip（来自系统共享菜单、「打开方式」、拖拽或命令行），完成解压→解析→建工作区，返回记录 */
export async function importZip(sourcePath: string, source: JobSource, options: ImportOptions = {}): Promise<JobSummary> {
  const settings = getSettings()
  const id = randomUUID()
  const createdAt = new Date()
  // Share Extension 会在文件名前加一个 UUID 防重名，这里还原微信的原始文件名
  const sourceZipName = basename(sourcePath).replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '')
  log.info(`[import] ${source} ${sourcePath}`)

  if (!isZipFile(sourcePath)) throw new Error(`不是有效的 zip 文件：${sourceZipName}`)

  // 1) 立刻复制：微信容器里的 zip 转发后可能被清理
  mkdirSync(incomingDir(), { recursive: true })
  const localZip = join(incomingDir(), `${id}.zip`)
  copyFileSync(sourcePath, localZip)
  const size = statSync(localZip).size
  log.info(`[import] copied ${size} bytes → ${localZip}`)
  if (options.removeSourceAfterCopy) rmSync(sourcePath, { force: true })

  // 2) 解压到临时目录
  const work = join(tmpDir(), id)
  mkdirSync(work, { recursive: true })
  const extracted = await extractZip(localZip, work)
  log.info(`[import] extracted ${extracted.length} entries`)

  // 3) 找 TXT 并解析
  const sizes = new Map(extracted.map((f) => [f.relPath, f.size]))
  const txtRel = locateTranscript(
    extracted.map((f) => f.relPath),
    sizes,
  )
  const mediaNames = extracted.filter((f) => f.relPath !== txtRel).map((f) => f.relPath)
  const fallbackTitle = sourceZipName.replace(/\.zip$/i, '').replace(/^(聊天记录|聊天記錄|Chat History)_?/i, '') || '聊天记录'
  const transcript = txtRel
    ? parseTranscript({
        text: readFileSync(join(work, ...txtRel.split('/')), 'utf8'),
        mediaFiles: mediaNames,
        fallbackTitle,
        txtFileName: basename(txtRel),
      })
    : parseTranscript({ text: '', mediaFiles: mediaNames, fallbackTitle: fallbackTitle || '一批文件' })
  if (!txtRel) log.warn('[import] 压缩包里没有 TXT，按「一批文件」处理')

  // 4) 建工作区
  ensureWorkspaceRoot(settings.workspaceRoot)
  const built = await buildWorkspace({
    jobId: id,
    createdAt,
    settings,
    transcript,
    extracted,
    txtRelPath: txtRel,
    sourceZipPath: localZip,
    sourceZipName,
  })
  rmSync(work, { recursive: true, force: true })
  // incoming/ 里的副本保留 7 天（housekeeping 清理），便于诊断解析问题时拿到微信的原始 zip
  const keptZip = join(incomingDir(), `${id}-${sourceZipName}`)
  try {
    renameSync(localZip, keptZip)
  } catch {
    rmSync(localZip, { force: true })
  }

  const job: JobSummary = {
    id,
    createdAt: createdAt.toISOString(),
    source,
    sourceZipName,
    workspaceRoot: settings.workspaceRoot,
    inboxDir: built.inboxDir,
    inboxRelPath: built.inboxRelPath,
    title: transcript.title,
    counts: transcript.counts,
    timeRange: transcript.timeRange,
    parseConfidence: transcript.parseConfidence,
    format: transcript.format,
    nested: transcript.nested,
    status: 'pending',
  }
  upsertJob(job)
  log.info(`[import] job ${id} ready → ${built.inboxDir}`)
  return job
}

export function getJobDetail(id: string): JobDetail | undefined {
  const job = getJob(id)
  if (!job) return undefined
  let preview: ChatMessage[] = []
  let mediaFiles: string[] = []
  try {
    const meta = JSON.parse(readFileSync(join(job.inboxDir, 'meta.json'), 'utf8')) as { mediaFiles?: string[] }
    mediaFiles = meta.mediaFiles ?? []
  } catch {
    /* 目录可能已被删除 */
  }
  try {
    const structured = join(job.inboxDir, 'transcript.json')
    if (existsSync(structured)) {
      const transcript = JSON.parse(readFileSync(structured, 'utf8')) as { messages: ChatMessage[] }
      preview = transcript.messages.slice(0, 120).map((m) => {
        const text = m.kind === 'nested'
          ? m.nestedStatus === 'expanded' || m.nestedStatus === 'partial' ? `[聊天记录] 已识别 ${m.children?.length ?? 0} 条内层消息（保留层级，见 transcript.md）` : '[聊天记录] 未能展开，见内容提示'
          : m.text
        return { index: m.index, sender: m.sender, time: m.time, kind: m.kind, text, raw: '' }
      })
    } else preview = previewFromTranscript(readFileSync(join(job.inboxDir, 'transcript.md'), 'utf8'))
  } catch {
    /* ignore */
  }
  return { ...job, preview, mediaFiles, handoffPrompt: buildHandoffPrompt(job) }
}

/** 从 transcript.md 反推预览（避免把整份原文塞进历史 JSON） */
function previewFromTranscript(md: string, limit = 120): ChatMessage[] {
  const out: ChatMessage[] = []
  const lines = md.split('\n')
  let date = ''
  let i = 0
  while (i < lines.length && out.length < limit) {
    const line = lines[i]
    if (line.startsWith('## ')) {
      date = line.slice(3).trim()
      i += 1
      continue
    }
    const head = /^\*\*(.+?)\*\*\s*(\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(line)
    if (head) {
      const body: string[] = []
      i += 1
      while (i < lines.length && lines[i] !== '' && !lines[i].startsWith('## ')) {
        body.push(lines[i])
        i += 1
      }
      const text = body.join('\n')
      const kind: ChatMessage['kind'] = text.startsWith('![图片]') ? 'image' : text.startsWith('[视频') ? 'video' : 'text'
      out.push({
        index: out.length,
        sender: head[1].replace(/\\([*_`])/g, '$1'),
        time: [date, head[2]].filter(Boolean).join(' '),
        kind,
        text: kind === 'text' ? text : kind === 'image' ? '[图片]' : '[视频]',
        raw: text,
      })
      continue
    }
    i += 1
  }
  return out
}

export async function deliverJob(id: string, opts: DeliverOptions): Promise<DeliverResult> {
  let note: string
  try { note = normalizeDeliveryNote(opts.note) }
  catch (error) { return { ok: false, error: (error as Error).message } }
  const job = getJob(id)
  if (!job) return { ok: false, error: '找不到这条记录' }
  if (!existsSync(job.inboxDir)) return { ok: false, error: '工作区目录已不存在，请重新从微信递一次' }
  const target = getTarget(opts.targetId)
  if (!target) return { ok: false, error: `未知目标：${opts.targetId}` }
  if (getSettings().disabledTargetIds.includes(target.id)) return { ok: false, error: `${target.name} 已停用，请在「目标应用」里打开` }
  const detected = await target.detect()
  if (!detected.available) return { ok: false, error: target.installHint ?? `${target.name} 未安装` }

  if (target.id === 'codex' && opts.codex?.mode === 'existing') {
    const destination = opts.codex
    try {
      if (!['open', 'queue'].includes(destination.action)) throw new Error('请选择有效的投递方式。')
      // Resolve again at delivery time. Never accept a workspace path supplied by the renderer.
      const thread = await getCodexThread(destination.threadId)
      const directory = copyBatchToThread(job, thread.cwd)
      const prompt = existingThreadPrompt(job, directory, thread.cwd, note)
      const url = `codex://threads/${thread.id}`
      if (destination.action === 'queue') {
        await queueCodexMessage(thread.id, prompt)
        // Queue success is independent of whether the desktop can navigate there.
        try { await shell.openExternal(url) } catch { /* user can open the queued thread later */ }
      } else {
        await shell.openExternal(url)
        clipboard.writeText(prompt)
      }
      const status = destination.action === 'queue' ? 'queued' : 'prepared'
      upsertJob({ ...job, status, deliveredTo: target.id, deliveredAt: new Date().toISOString(),
        deliveredThreadId: thread.id, deliveredThreadName: thread.title, deliveredDirectory: directory,
        lastPrompt: prompt, error: undefined })
      updateSettings({ codexDestination: 'existing', codexThreadId: thread.id, codexExistingAction: destination.action })
      return { ok: true, status, prompt, targetName: `Codex · ${thread.title}`,
        nextStep: destination.action === 'queue'
          ? '请求已交给 Codex 排队；请在目标会话查看处理进度。'
          : '目标会话已打开，提示词已复制。请在输入框按 ⌘V，检查后按回车发送。' }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      upsertJob({ ...job, status: 'failed', error })
      return { ok: false, error }
    }
  }

  const { prompt, attachments } = handoffFor(job, target, note)
  try {
    writeFileSync(join(job.inboxDir, 'prompt.md'), prompt, 'utf8')
  } catch (err) {
    log.warn('写入 prompt.md 失败', err)
  }

  try {
    await target.deliver({ job, workspaceRoot: job.workspaceRoot, inboxDir: job.inboxDir, prompt, attachments })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    upsertJob({ ...job, status: 'failed', error })
    log.error(`[deliver] ${id} → ${target.id} failed`, err)
    return { ok: false, error }
  }

  upsertJob({
    ...job,
    status: 'delivered',
    deliveredTo: target.id,
    deliveredAt: new Date().toISOString(),
    deliveredThreadId: undefined,
    deliveredThreadName: undefined,
    deliveredDirectory: undefined,
    lastPrompt: prompt,
    error: undefined,
  })
  if (opts.rememberSkipConfirm) updateSettings({ skipConfirm: true, defaultTargetId: target.id })
  if (target.id === 'codex') updateSettings({ codexDestination: 'new' })
  log.info(`[deliver] ${id} → ${target.id} ok`)
  return { ok: true, prompt, targetName: target.id === 'codex' ? 'Codex' : detected.appName ?? target.name, nextStep: target.nextStep }
}

/**
 * 按目标的能力决定提示词与随行文件：
 *   workspace：只说路径；inline：先定下带哪些文件，提示词里说清附件里有什么。
 */
function handoffFor(job: JobSummary, target: Target, note = ''): { prompt: string; attachments: string[] } {
  if (target.capabilities.attachments === 'inline') {
    const plan = existsSync(job.inboxDir) ? planAttachments(job.inboxDir) : undefined
    return { prompt: buildHandoffPrompt(job, plan, note), attachments: plan?.files ?? [] }
  }
  return { prompt: buildHandoffPrompt(job, undefined, note), attachments: [] }
}

export function copyLastPrompt(id: string): void {
  const job = getJob(id)
  if (!job?.lastPrompt) throw new Error('还没有可复制的交接内容。')
  clipboard.writeText(job.lastPrompt)
}

/** 只返回已投递的目标，不创建新会话，也不重新发送。 */
export async function reopenDeliveredTarget(id: string): Promise<void> {
  const job = getJob(id)
  if (!job?.deliveredTo) throw new Error('还没有目标应用。')
  if (job.deliveredTo === 'codex' && job.deliveredThreadId) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(job.deliveredThreadId)) throw new Error('目标会话无效。')
    await shell.openExternal(`codex://threads/${job.deliveredThreadId}`)
    return
  }
  const detected = await getTarget(job.deliveredTo)?.detect()
  if (!detected?.appPath) throw new Error('无法打开目标应用，请从 Dock 打开。')
  const error = await shell.openPath(detected.appPath)
  if (error) throw new Error(error)
}

/** 确认窗预览用：这份记录递给某个目标时会带的上下文（不同目标措辞不同） */
export function handoffPromptFor(id: string, targetId: string): string | undefined {
  const job = getJob(id)
  const target = getTarget(targetId)
  if (!job || !target) return undefined
  return handoffFor(job, target).prompt
}

export function cancelJob(id: string): void {
  const job = getJob(id)
  if (job && job.status === 'pending') upsertJob({ ...job, status: 'cancelled' })
}

export function revealJob(id: string): void {
  const job = getJob(id)
  if (job && existsSync(job.inboxDir)) shell.showItemInFolder(join(job.inboxDir, 'transcript.md'))
}

export function deleteJob(id: string, deleteFiles: boolean): void {
  const job = getJob(id)
  if (job && deleteFiles && existsSync(job.inboxDir)) rmSync(job.inboxDir, { recursive: true, force: true })
  removeJob(id)
}

export function clearHistory(): void {
  for (const job of listHistory()) {
    if (existsSync(job.inboxDir)) rmSync(job.inboxDir, { recursive: true, force: true })
  }
  replaceHistory([])
}

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) total += dirSize(p)
      else if (entry.isFile()) total += statSync(p).size
    }
  } catch {
    /* ignore */
  }
  return total
}

export function historyStats(): HistoryStats {
  const jobs = listHistory()
  let bytes = 0
  for (const j of jobs) if (existsSync(j.inboxDir)) bytes += dirSize(j.inboxDir)
  return { count: jobs.length, bytes }
}

/** 启动时：剔除目录已不存在的记录；按保留天数清理过期目录；incoming/ 只留最近 7 天 */
export function housekeeping(): void {
  const settings = getSettings()
  const now = Date.now()
  for (const job of listHistory()) {
    if (!existsSync(job.inboxDir)) {
      removeJob(job.id)
      continue
    }
    if (settings.retentionDays > 0) {
      const age = (now - new Date(job.createdAt).getTime()) / 86_400_000
      if (age > settings.retentionDays && job.status !== 'pending') {
        rmSync(job.inboxDir, { recursive: true, force: true })
        removeJob(job.id)
      }
    }
  }
  rmSync(tmpDir(), { recursive: true, force: true })
  try {
    for (const name of readdirSync(incomingDir())) {
      const p = join(incomingDir(), name)
      if (now - statSync(p).mtimeMs > 7 * 86_400_000) rmSync(p, { force: true })
    }
  } catch {
    /* 目录可能还不存在 */
  }
}
