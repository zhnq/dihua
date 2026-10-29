import React, { useEffect, useMemo, useRef, useState } from 'react'
import { App as AntApp, Button, ConfigProvider, Dropdown, Input, Spin, Switch } from 'antd'
import { ArrowLeftOutlined, CheckOutlined, ClockCircleOutlined, CopyOutlined, DownOutlined, EllipsisOutlined, ExclamationCircleOutlined, FileTextOutlined, FormOutlined, RightOutlined } from '@ant-design/icons'
import { useParams } from 'react-router-dom'
import type { CodexDestination, CodexThread, DeliverResult, JobDetail, Settings, TargetInfo } from '@shared/types'
import { TargetIcon } from '../components/TargetIcon'
import CodexConversationPicker from '../components/CodexConversationPicker'
import ContentPreview from '../components/ContentPreview'

type View = 'compact' | 'conversation' | 'content' | 'options'
type Done = Extract<DeliverResult, { ok: true }>
const appLabel = (target?: TargetInfo) => target?.id === 'codex' ? 'Codex' : target?.name.replace(/桌面端|（.*）/g, '') ?? '目标应用'

export default function ConfirmPage(): React.JSX.Element {
  const { jobId = '' } = useParams()
  const { message } = AntApp.useApp()
  const [job, setJob] = useState<JobDetail | null>()
  const [settings, setSettings] = useState<Settings>()
  const [targets, setTargets] = useState<TargetInfo[]>([])
  const [targetMenuOpen, setTargetMenuOpen] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [codex, setCodex] = useState<CodexDestination>({ mode: 'new' })
  const [codexReady, setCodexReady] = useState(false)
  const [thread, setThread] = useState<CodexThread>()
  const [view, setView] = useState<View>('compact')
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [remember, setRemember] = useState(false)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<Done>()
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const sendingLock = useRef(false)
  const primary = useRef<React.ComponentRef<typeof Button>>(null)
  const focused = useRef(false)

  useEffect(() => {
    let alive = true
    setLoadError('')
    void Promise.all([window.dihua.jobs.get(jobId), window.dihua.settings.get(), window.dihua.targets.list()]).then(([j, s, t]) => {
      if (!alive) return
      setJob(j ?? null)
      setSettings(s)
      if (s.codexDestination === 'existing') setCodex({ mode: 'existing', threadId: s.codexThreadId ?? '', action: s.codexExistingAction ?? 'open' })
      const usable = t.filter((item) => item.enabled)
      setTargets(usable)
      setTargetId((usable.find((item) => item.id === s.defaultTargetId && item.available) ?? usable.find((item) => item.available) ?? usable[0])?.id ?? '')
    }).catch(() => { if (alive) setLoadError('暂时无法读取这批记录，请重试。') })
    return () => { alive = false }
  }, [jobId, reload])

  const target = useMemo(() => targets.find((item) => item.id === targetId), [targets, targetId])
  const label = appLabel(target)
  const existing = targetId === 'codex' && codex.mode === 'existing'
  const queue = existing && codex.action === 'queue'
  const canSend = !!job && !!target?.available && (!existing || codexReady) && !sending && !done && view === 'compact'

  useEffect(() => {
    void window.dihua.app.confirmView(done ? 'done' : view === 'compact' && noteOpen ? 'options' : view).catch(() => { /* 窗口关闭时无需再调整 */ })
  }, [view, noteOpen, done])

  useEffect(() => {
    if (!canSend || focused.current) return
    focused.current = true
    if (!['INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName ?? '')) primary.current?.focus()
  }, [canSend])

  async function send(): Promise<void> {
    if (!canSend || sendingLock.current) return
    sendingLock.current = true
    setSending(true)
    setError('')
    try {
      const result = await window.dihua.jobs.deliver(jobId, { targetId, note, rememberSkipConfirm: !existing && remember, ...(targetId === 'codex' ? { codex } : {}) })
      if (result.ok) setDone(result)
      else setError(result.error)
    } catch { setError('投递未完成。你的目标和说明已保留，请检查后重试。') }
    finally { sendingLock.current = false; setSending(false) }
  }

  async function cancel(): Promise<void> {
    if (sendingLock.current) return
    try {
      await window.dihua.jobs.cancel(jobId)
      await window.dihua.app.closeWindow()
    } catch { setError('暂时无法关闭这批记录，请重试或使用窗口关闭按钮。') }
  }

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented || sendingLock.current) return
      // 菜单优先处理快捷键，Esc 只收起菜单，不能取消整批记录。
      if (targetMenuOpen) {
        if (event.key === 'Escape') { event.preventDefault(); setTargetMenuOpen(false) }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        if (view !== 'compact') setView('compact')
        else if (done) void window.dihua.app.closeWindow()
        else void cancel()
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSend) { event.preventDefault(); void send() }
    }
    document.addEventListener('keydown', keyboard)
    return () => document.removeEventListener('keydown', keyboard)
  })

  const stats = job ? [`${job.counts.messages} 条消息`, ...(job.nested?.messages ? [`${job.nested.messages} 条内层`] : []), ...(job.counts.images ? [`${job.counts.images} 张照片`] : []), ...(job.counts.videos ? [`${job.counts.videos} 段视频`] : []), ...(job.counts.files ? [`${job.counts.files} 个文件`] : [])].join(' · ') : ''
  const title = done ? '交接状态' : view === 'conversation' ? '选择会话' : view === 'content' ? '本次内容' : view === 'options' ? '转发选项' : `递给 ${label}`
  const buttonLabel = queue ? '发送到会话' : existing ? '复制并打开会话' : target?.capabilities.promptVia === 'clipboard' ? '复制并打开应用' : `打开 ${label}`
  const helper = queue ? '将向所选会话提交处理请求' : existing || target?.capabilities.promptVia === 'clipboard' ? '打开后 ⌘V，再回车发送' : '打开后检查内容，再回车发送'

  return <ConfigProvider button={{ autoInsertSpace: false }}><div className="confirm-root">
    <header className="confirm-titlebar drag-region">
      {view !== 'compact' && !done && <Button type="text" size="small" className="confirm-back" icon={<ArrowLeftOutlined />} onClick={() => setView('compact')}>返回</Button>}
      <h1 aria-label={title}>{view === 'compact' && !done && targets.length > 1 ? <Dropdown trigger={['click']} disabled={sending} open={targetMenuOpen} onOpenChange={setTargetMenuOpen} menu={{ selectedKeys: [targetId], items: targets.map((item) => ({ key: item.id, label: <span className="target-menu-label"><TargetIcon target={item} size={16} />{appLabel(item)}{!item.available ? ' · 未安装' : ''}</span>, disabled: !item.available })), onClick: ({ key }) => { setTargetId(key); setTargetMenuOpen(false); setError('') } }}><button className="title-app-switch" aria-label={`更换目标应用，当前 ${label}`}>{title}<DownOutlined /></button></Dropdown> : title}</h1>
      {view === 'compact' && !done && job && <Button type="text" className="confirm-more" icon={<EllipsisOutlined />} aria-label="转发选项" disabled={sending} onClick={() => setView('options')} />}
    </header>

    {loadError ? <main className="list-state" role="alert"><p>{loadError}</p><Button onClick={() => setReload((n) => n + 1)}>重试</Button></main>
      : job === undefined || !settings ? <main className="list-state" role="status"><Spin /><span>正在准备本次内容…</span></main>
        : job === null ? <main className="list-state"><FileTextOutlined /><strong>找不到这批记录</strong><span>请重新从微信转发。</span><Button onClick={() => window.dihua.app.closeWindow()}>关闭</Button></main>
          : done ? <main className="handoff-result">
            <span className="handoff-status-icon">{done.status === 'queued' ? <ClockCircleOutlined /> : done.status === 'prepared' || target?.capabilities.promptVia === 'clipboard' ? <CopyOutlined /> : <CheckOutlined />}</span>
            <h2>{done.status === 'queued' ? '请求已排队' : done.status === 'prepared' || target?.capabilities.promptVia === 'clipboard' ? '已复制，等待粘贴' : '已打开目标应用'}</h2>
            <strong className="result-destination">{done.targetName}</strong>
            <p>{done.nextStep}</p>
            <div className="result-actions"><Button onClick={() => void window.dihua.jobs.copyPrompt(jobId).then(() => message.success('已重新复制')).catch(() => message.error('复制失败，请重试'))}>重新复制</Button><Button onClick={() => void window.dihua.jobs.reopenTarget(jobId).catch(() => message.error('无法打开目标，请从 Dock 打开应用'))}>{existing ? '打开目标会话' : '打开目标应用'}</Button></div>
          </main> : <main className={`confirm-body view-${view}`}>
            <div hidden={view !== 'compact'}>
              <section className="source-summary" aria-label="本次内容摘要"><span className="source-icon"><FileTextOutlined /></span><div className="source-copy"><strong title={job.title}>{job.title}</strong><span>{stats}</span></div><button className="text-action source-disclosure" disabled={sending} onClick={() => setView('content')}>查看内容<RightOutlined /></button></section>
              {!!job.nested?.unresolved && <button className="summary-warning" disabled={sending} onClick={() => setView('content')}><ExclamationCircleOutlined /><span>{job.nested.unresolved} 段嵌套记录未能完整展开</span><RightOutlined /></button>}
              {job.parseConfidence !== 'high' && <button className="summary-warning" disabled={sending} onClick={() => setView('content')}><ExclamationCircleOutlined /><span>{job.parseConfidence === 'low' ? '记录格式未识别，已保留微信原文' : '记录条数或格式需核对'}</span><RightOutlined /></button>}
              <div className="section-divider" />
              {!target?.available && <div className="inline-error" role="alert">没有可用的目标应用。<button className="text-action" onClick={() => void window.dihua.app.showMain('/targets')}>打开目标应用设置</button></div>}
            </div>
            {targetId === 'codex' && <div hidden={view !== 'compact' && view !== 'conversation'}><CodexConversationPicker value={codex} onChange={(value) => { setCodexReady(value.mode === 'new'); setCodex(value); setError('') }} onReady={setCodexReady} onThread={setThread} choosing={view === 'conversation'} onChoosing={(choosing) => setView(choosing ? 'conversation' : 'compact')} disabled={sending} /></div>}
            {targetId !== 'codex' && view === 'compact' && <section className="recipient-section"><h2>目标应用</h2><div className="recipient-row"><span className="recipient-icon">{target && <TargetIcon target={target} size={24} />}</span><div className="recipient-copy"><strong>{label}</strong><span>{target?.capabilities.attachments === 'inline' ? '聊天记录和随行附件' : '在新会话中读取本次内容'}</span></div></div></section>}
            <div hidden={view !== 'compact'} className="note-section"><button className="note-disclosure" disabled={sending} aria-expanded={noteOpen} onClick={() => setNoteOpen((open) => !open)}><FormOutlined /><span>{noteOpen ? '附加说明（仅本次）' : note.trim() ? '编辑附加说明' : '添加说明…'}</span><DownOutlined className={noteOpen ? 'disclosure-open' : ''} /></button>{noteOpen && <Input.TextArea className="delivery-note" autoFocus aria-label="本次附加说明" placeholder="例如：总结重点，提取待办，并检查附件。" maxLength={2000} value={note} disabled={sending} onChange={(event) => setNote(event.target.value)} autoSize={{ minRows: 3, maxRows: 5 }} />}</div>
            <div hidden={view !== 'content'} className="preview-wrapper"><ContentPreview job={job} active={view === 'content'} /></div>
            {view === 'options' && <section className="transfer-options">
              <h2>发送方式</h2>
              {existing ? <><div className="option-switch"><div><strong>直接发送到会话</strong><span>实验功能 · 开启后会提交处理请求</span></div><Switch aria-label="直接发送到会话，实验功能" checked={queue} onChange={(checked) => setCodex({ ...codex, action: checked ? 'queue' : 'open' })} /></div><p>关闭时只复制提示词并打开会话，由你粘贴、检查和发送。</p><p className="option-destination">目标：{thread?.title ?? '所选会话'}</p></> : <p>记录会交给 {label}，由你检查后发送。</p>}
              {!existing && <div className="option-switch"><div><strong>下次直接递给 {label}</strong><span>本次交接成功后生效，可在通用设置中关闭</span></div><Switch aria-label="下次直接转发" checked={remember} onChange={setRemember} /></div>}
              {existing && <p>每次转发都会确认目标会话，成功后记住本次选择。</p>}
              <details className="delivery-details"><summary>记录与附件如何交接</summary><p>{existing ? '本次记录会独立复制到目标会话的工作区。嵌套关系、图片和文件一并保留。' : '记录与附件保存在本地递话工作区，按目标应用支持的方式交接。'} 附加说明只用于本次交接，不保存为默认要求。</p><button className="text-action" onClick={() => void window.dihua.jobs.reveal(jobId)}>在 Finder 中显示本批记录</button></details>
              <button className="text-action app-settings-link" onClick={() => void window.dihua.app.showMain('/general')}>打开递话设置</button>
            </section>}
          </main>}

    {job && settings && <footer className="confirm-footer">
      {error && <div className="delivery-error" role="alert"><ExclamationCircleOutlined />{error}</div>}
      <div className="footer-row"><span className="footer-hint">{done ? done.status === 'queued' ? '可在目标会话查看处理进度' : '交接内容已保留在本地' : view === 'compact' ? helper : view === 'conversation' ? '方向键选择，回车确认' : view === 'content' ? '预览不会提交内容' : '返回后确认目标，再执行交接'}</span><div className="footer-actions">{done ? <Button type="primary" onClick={() => window.dihua.app.closeWindow()}>关闭</Button> : view === 'compact' ? <><Button disabled={sending} onClick={() => void cancel()}>取消</Button><Button ref={primary} type="primary" loading={sending} disabled={!canSend} title="⌘↵" onClick={() => void send()}>{sending ? '正在准备…' : buttonLabel}</Button></> : <Button type="primary" onClick={() => setView('compact')}>完成</Button>}</div></div>
    </footer>}
  </div></ConfigProvider>
}
