import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobSummary } from '../src/shared/types'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mock = vi.hoisted(() => ({
  getJob: vi.fn(), getSettings: vi.fn(), upsertJob: vi.fn(), updateSettings: vi.fn(),
  openExternal: vi.fn(), writeText: vi.fn(),
  getThread: vi.fn(), copy: vi.fn(), queue: vi.fn(), deliver: vi.fn(),
}))
vi.mock('electron', () => ({ shell: { openExternal: mock.openExternal }, clipboard: { writeText: mock.writeText } }))
vi.mock('../src/main/store', () => ({ getJob: mock.getJob, getSettings: mock.getSettings, upsertJob: mock.upsertJob, updateSettings: mock.updateSettings }))
vi.mock('../src/main/log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../src/main/paths', () => ({}))
vi.mock('../src/main/codex', () => ({
  getCodexThread: mock.getThread, copyBatchToThread: mock.copy, queueCodexMessage: mock.queue,
  existingThreadPrompt: () => 'read the copied batch',
}))
vi.mock('../src/main/targets/registry', () => ({ getTarget: () => ({
  id: 'codex', name: 'Codex', capabilities: { attachments: 'workspace' },
  detect: async () => ({ available: true }), deliver: mock.deliver,
}) }))
import { copyLastPrompt, deliverJob, reopenDeliveredTarget } from '../src/main/jobs'

const ID = '11111111-2222-4333-8444-555555555555'
beforeEach(() => {
  vi.resetAllMocks()
  mock.getJob.mockReturnValue({ id: 'job', inboxDir: process.cwd(), workspaceRoot: process.cwd(), counts: { messages: 1 }, title: '测试' } as JobSummary)
  mock.getSettings.mockReturnValue({ disabledTargetIds: [] })
  mock.getThread.mockResolvedValue({ id: ID, cwd: '/project', title: '项目讨论' })
  mock.copy.mockReturnValue('/project/dihua-inbox/batch')
  mock.openExternal.mockResolvedValue(undefined)
  mock.queue.mockResolvedValue(undefined)
})

describe('delivery outcomes', () => {
  it('clears the old destination when a previously delivered batch is sent to a new conversation', async () => {
    const inbox = mkdtempSync(join(tmpdir(), 'dihua-redeliver-'))
    try {
      mock.getJob.mockReturnValue({ id: 'job', inboxDir: inbox, inboxRelPath: 'inbox/test', workspaceRoot: inbox, title: '测试', counts: { messages: 1 }, deliveredThreadId: ID, deliveredThreadName: '旧会话', deliveredDirectory: '/old' })
      const result = await deliverJob('job', { targetId: 'codex', codex: { mode: 'new' }, note: '本次要求' })
      expect(result.ok).toBe(true)
      expect(mock.upsertJob).toHaveBeenCalledWith(expect.objectContaining({ deliveredThreadId: undefined, deliveredThreadName: undefined, deliveredDirectory: undefined, lastPrompt: expect.stringContaining('本次要求') }))
      expect(mock.queue).not.toHaveBeenCalled()
    } finally { rmSync(inbox, { recursive: true, force: true }) }
  })
  it('validates an overlong note before copying, opening or queueing anything', async () => {
    const result = await deliverJob('job', { targetId: 'codex', note: '长'.repeat(2001), codex: { mode: 'existing', threadId: ID, action: 'open' } })
    expect(result.ok).toBe(false)
    expect(mock.copy).not.toHaveBeenCalled()
    expect(mock.openExternal).not.toHaveBeenCalled()
    expect(mock.queue).not.toHaveBeenCalled()
  })

  it('copy and reopen recovery actions never resend or create a conversation', async () => {
    mock.getJob.mockReturnValue({ lastPrompt: '已有提示词', deliveredTo: 'codex', deliveredThreadId: ID })
    copyLastPrompt('job')
    await reopenDeliveredTarget('job')
    expect(mock.writeText).toHaveBeenCalledExactlyOnceWith('已有提示词')
    expect(mock.openExternal).toHaveBeenCalledExactlyOnceWith(`codex://threads/${ID}`)
    expect(mock.queue).not.toHaveBeenCalled()
    expect(mock.deliver).not.toHaveBeenCalled()
    expect(mock.copy).not.toHaveBeenCalled()
  })
  it('opens exactly the selected thread and copies text without starting a turn', async () => {
    const result = await deliverJob('job', { targetId: 'codex', rememberSkipConfirm: true, codex: { mode: 'existing', threadId: ID, action: 'open' } })
    expect(result).toMatchObject({ ok: true, status: 'prepared' })
    expect(mock.openExternal).toHaveBeenCalledWith(`codex://threads/${ID}`)
    expect(mock.writeText).toHaveBeenCalledWith('read the copied batch')
    expect(mock.queue).not.toHaveBeenCalled()
    expect(mock.deliver).not.toHaveBeenCalled()
    expect(mock.upsertJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'prepared', deliveredThreadId: ID, deliveredDirectory: '/project/dihua-inbox/batch' }))
    expect(mock.updateSettings).not.toHaveBeenCalledWith(expect.objectContaining({ skipConfirm: true }))
  })

  it('queues once, keeps the queued outcome if navigation fails, and does not claim completed processing', async () => {
    mock.openExternal.mockRejectedValue(new Error('navigation unavailable'))
    const result = await deliverJob('job', { targetId: 'codex', codex: { mode: 'existing', threadId: ID, action: 'queue' } })
    expect(result).toMatchObject({ ok: true, status: 'queued' })
    expect(mock.queue).toHaveBeenCalledExactlyOnceWith(ID, 'read the copied batch')
    expect(mock.writeText).not.toHaveBeenCalled()
  })

  it('keeps failures retryable without falling back to another thread or updating the remembered choice', async () => {
    mock.queue.mockRejectedValue(new Error('queue unavailable'))
    expect(await deliverJob('job', { targetId: 'codex', codex: { mode: 'existing', threadId: ID, action: 'queue' } })).toEqual({ ok: false, error: 'queue unavailable' })
    expect(mock.upsertJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
    expect(mock.openExternal).not.toHaveBeenCalled()
    expect(mock.updateSettings).not.toHaveBeenCalled()
    expect(mock.deliver).not.toHaveBeenCalled()
  })

  it('does not copy or send when the selected conversation can no longer be resolved', async () => {
    mock.getThread.mockRejectedValue(new Error('missing thread'))
    const result = await deliverJob('job', { targetId: 'codex', codex: { mode: 'existing', threadId: ID, action: 'open' } })
    expect(result.ok).toBe(false)
    expect(mock.copy).not.toHaveBeenCalled()
    expect(mock.queue).not.toHaveBeenCalled()
  })
})
