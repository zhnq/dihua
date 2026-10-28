import React, { useEffect, useRef, useState } from 'react'
import { Button, Input, Spin } from 'antd'
import { CheckOutlined, CommentOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { CodexDestination, CodexThread } from '@shared/types'

function projectName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

export default function CodexConversationPicker({ value, onChange, onReady, onThread, choosing, onChoosing, disabled = false }: {
  value: CodexDestination
  onChange: (value: CodexDestination) => void
  onReady: (ready: boolean) => void
  onThread: (thread: CodexThread | undefined) => void
  choosing: boolean
  onChoosing: (choosing: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  const [threads, setThreads] = useState<CodexThread[]>([])
  const [selected, setSelected] = useState<CodexThread>()
  const [search, setSearch] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [selectionError, setSelectionError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [active, setActive] = useState(0)
  const request = useRef(0)
  const paging = useRef(false)
  const input = useRef<React.ComponentRef<typeof Input>>(null)
  const existing = value.mode === 'existing'
  const threadId = existing ? value.threadId : ''

  useEffect(() => {
    if (!choosing) return
    setSearch('')
    setActive(0)
    input.current?.focus()
  }, [choosing])

  useEffect(() => {
    if (!choosing) return
    const generation = ++request.current
    setThreads([])
    setCursor(null)
    setLoading(true)
    setListError('')
    const timer = setTimeout(() => {
      void window.dihua.codex.threads({ search }).then((result) => {
        if (generation !== request.current) return
        if (result.ok) { setThreads(result.threads); setCursor(result.nextCursor) }
        else setListError(result.error)
      }).catch(() => {
        if (generation === request.current) setListError('读取会话失败，请重试。')
      }).finally(() => { if (generation === request.current) setLoading(false) })
    }, search ? 250 : 0)
    return () => { clearTimeout(timer); ++request.current }
  }, [choosing, search, refresh])

  useEffect(() => {
    setSelected(undefined)
    setSelectionError('')
    onThread(undefined)
    if (!existing) { onReady(true); return }
    onReady(false)
    if (!threadId) { setSelectionError('请选择一个会话。'); return }
    let alive = true
    void window.dihua.codex.thread(threadId).then((result) => {
      if (!alive) return
      if (result.ok) { setSelected(result.thread); onThread(result.thread); onReady(true) }
      else setSelectionError(result.error)
    }).catch(() => { if (alive) setSelectionError('无法读取这个会话，请更换目标或重试。') })
    return () => { alive = false }
  }, [existing, threadId, refresh, onReady, onThread])

  async function loadMore(): Promise<void> {
    if (!cursor || loading || paging.current) return
    paging.current = true
    const generation = request.current
    setLoading(true)
    try {
      const result = await window.dihua.codex.threads({ search, cursor })
      if (generation !== request.current) return
      if (result.ok) {
        setThreads((current) => [...new Map([...current, ...result.threads].map((t) => [t.id, t])).values()])
        setCursor(result.nextCursor)
      } else setListError(result.error)
    } catch { if (generation === request.current) setListError('读取更多会话失败，请重试。') }
    finally { paging.current = false; if (generation === request.current) setLoading(false) }
  }

  function choose(thread: CodexThread): void {
    onReady(false)
    // 再次选中当前会话时也重新验证，避免就绪状态一直停在 false。
    setRefresh((n) => n + 1)
    onChange({ mode: 'existing', threadId: thread.id, action: value.mode === 'existing' ? value.action : 'open' })
    onChoosing(false)
  }

  function keyboard(event: React.KeyboardEvent): void {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onChoosing(false) }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && threads.length) {
      event.preventDefault()
      const next = Math.max(0, Math.min(threads.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)))
      setActive(next)
      document.getElementById(`conversation-${next}`)?.scrollIntoView({ block: 'nearest' })
    }
    if (event.key === 'Enter' && !event.metaKey && threads[active]) { event.preventDefault(); choose(threads[active]) }
  }

  const current = selected?.id === threadId ? selected : undefined
  if (!choosing) return <section className="recipient-section" aria-label="目标会话">
    <h2>目标会话</h2>
    <div className="recipient-row">
      <span className="recipient-icon"><CommentOutlined /></span>
      <div className="recipient-copy" aria-live="polite">
        <strong title={current?.title}>{existing ? current?.title ?? (selectionError ? '会话暂不可用' : '正在读取会话…') : '新建 Codex 会话'}</strong>
        <span title={current?.cwd}>{existing ? current ? `项目：${projectName(current.cwd)}` : '请选择可用的本地会话' : '在递话工作区中开始'}</span>
      </div>
      <Button type="link" disabled={disabled} onClick={() => onChoosing(true)}>更换</Button>
    </div>
    {selectionError && <div className="inline-error" role="alert">{selectionError} <button className="text-action" onClick={() => setRefresh((n) => n + 1)}>重试</button></div>}
  </section>

  return <section className="conversation-chooser">
    <Input ref={input} autoFocus size="large" prefix={<SearchOutlined />} value={search} placeholder="搜索会话名称" aria-label="搜索 Codex 会话" aria-controls="conversation-list" aria-activedescendant={threads.length ? `conversation-${active}` : undefined} onKeyDown={keyboard} onChange={(event) => {
      ++request.current
      setThreads([])
      setCursor(null)
      setSearch(event.target.value)
      setActive(0)
      setLoading(true)
    }} />
    <div className="chooser-label"><span>{search ? '搜索结果' : '最近会话'}</span><Button type="text" size="small" icon={<ReloadOutlined />} aria-label="刷新会话" disabled={loading} onClick={() => setRefresh((n) => n + 1)} /></div>
    <div id="conversation-list" className="conversation-list" role="listbox" aria-label="Codex 会话" aria-busy={loading} tabIndex={0} onKeyDown={keyboard} onScroll={(event) => {
      const list = event.currentTarget
      if (list.scrollHeight - list.scrollTop - list.clientHeight < 120) void loadMore()
    }}>
      {threads.map((thread, index) => <button key={thread.id} id={`conversation-${index}`} role="option" aria-selected={thread.id === threadId} tabIndex={-1} disabled={disabled} className={`conversation-option ${active === index ? 'keyboard-active' : ''}`} onMouseEnter={() => setActive(index)} onClick={() => choose(thread)}>
        <CommentOutlined className="conversation-symbol" />
        <span className="conversation-copy"><strong>{thread.title}</strong><small title={thread.cwd}>{projectName(thread.cwd)} · {dayjs.unix(thread.updatedAt).format('MM-DD HH:mm')}</small></span>
        {thread.id === threadId && <CheckOutlined className="selection-check" />}
      </button>)}
      {loading && <div className="list-state" role="status"><Spin size="small" /><span>正在读取会话…</span></div>}
      {!loading && !listError && !threads.length && <div className="list-state"><strong>没有找到会话</strong><span>{search ? '试试其他名称，或新建一个会话。' : '可以新建会话，或刷新重试。'}</span></div>}
      {listError && <div className="list-state" role="alert"><span>{listError}</span><Button onClick={() => setRefresh((n) => n + 1)}>重试</Button></div>}
      {cursor && !loading && <button className="text-action load-more" onClick={() => void loadMore()}>显示更多会话</button>}
    </div>
    <button className="new-conversation" disabled={disabled} onClick={() => { onChange({ mode: 'new' }); onChoosing(false) }}><PlusOutlined />新建会话</button>
  </section>
}
