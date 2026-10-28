import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Flex, Radio, Select, Space, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { CodexDestination, CodexThread } from '@shared/types'

export default function CodexConversationPicker({ value, onChange, onReady, disabled = false, rememberedId = '' }: {
  value: CodexDestination
  onChange: (value: CodexDestination) => void
  onReady: (ready: boolean) => void
  disabled?: boolean
  rememberedId?: string
}): React.JSX.Element {
  const [threads, setThreads] = useState<CodexThread[]>([])
  const [selected, setSelected] = useState<CodexThread>()
  const [search, setSearch] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const request = useRef(0)
  const existing = value.mode === 'existing'
  const threadId = existing ? value.threadId : ''

  useEffect(() => {
    if (!existing) { onReady(true); return }
    const generation = ++request.current
    const timer = setTimeout(() => {
      setLoading(true)
      setError('')
      void window.dihua.codex.threads({ search }).then((result) => {
        if (generation !== request.current) return
        if (result.ok) { setThreads(result.threads); setCursor(result.nextCursor) }
        else { setThreads([]); setCursor(null); setError(result.error) }
      }).catch(() => {
        if (generation === request.current) setError('读取会话失败，请刷新重试。')
      }).finally(() => { if (generation === request.current) setLoading(false) })
    }, search ? 300 : 0)
    return () => { clearTimeout(timer); ++request.current }
  }, [existing, search, refresh, onReady])

  useEffect(() => {
    if (!existing) { setSelected(undefined); onReady(true); return }
    setSelected(undefined)
    onReady(false)
    if (!threadId) return
    let alive = true
    void window.dihua.codex.thread(threadId).then((result) => {
      if (!alive) return
      if (result.ok) { setSelected(result.thread); onReady(true) }
      else setError(result.error)
    }).catch(() => { if (alive) setError('无法读取选中的会话，请重新选择。') })
    return () => { alive = false }
  }, [existing, threadId, refresh, onReady])

  async function loadMore(): Promise<void> {
    if (!cursor || loading) return
    const generation = request.current
    setLoading(true)
    try {
      const result = await window.dihua.codex.threads({ search, cursor })
      if (generation !== request.current) return
      if (result.ok) {
        setThreads((current) => [...new Map([...current, ...result.threads].map((t) => [t.id, t])).values()])
        setCursor(result.nextCursor)
      } else setError(result.error)
    } catch { if (generation === request.current) setError('读取更多会话失败，请重试。') }
    finally { if (generation === request.current) setLoading(false) }
  }

  const options = [...new Map([...(selected ? [selected] : []), ...threads].map((t) => [t.id, t])).values()]
  return <Space direction="vertical" style={{ width: '100%', marginTop: 12 }} size={10}>
    <Radio.Group aria-label="Codex 会话" value={value.mode} disabled={disabled} onChange={(event) => {
      onChange(event.target.value === 'existing'
        ? { mode: 'existing', threadId: rememberedId, action: 'open' } : { mode: 'new' })
    }}>
      <Radio.Button value="new">新建会话</Radio.Button>
      <Radio.Button value="existing">已有会话</Radio.Button>
    </Radio.Group>
    {existing && <>
      <Flex gap={8}>
        <Select
          aria-label="选择已有 Codex 会话"
          showSearch={{ filterOption: false, onSearch: setSearch }}
          value={threadId || undefined}
          onChange={(id) => onChange({ ...value, mode: 'existing', threadId: id })}
          placeholder="搜索会话标题，或选择最近的会话"
          loading={loading}
          disabled={disabled}
          style={{ flex: 1, minWidth: 0 }}
          options={options.map((t) => ({ value: t.id, label: t.title }))}
          optionRender={(option) => {
            const thread = options.find((t) => t.id === option.value)
            return <Flex vertical gap={2}>
              <Typography.Text>{thread?.title ?? option.label}</Typography.Text>
              <Typography.Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                {thread?.updatedAt ? `${dayjs.unix(thread.updatedAt).format('MM-DD HH:mm')} · ` : ''}{thread?.cwd}
              </Typography.Text>
            </Flex>
          }}
          notFoundContent={loading ? '正在读取会话…' : '没有找到会话，可更换搜索词或新建会话'}
        />
        <Button icon={<ReloadOutlined />} aria-label="刷新 Codex 会话" disabled={disabled || loading} onClick={() => setRefresh((n) => n + 1)} />
      </Flex>
      {cursor && <Button type="link" size="small" loading={loading} disabled={disabled} onClick={() => void loadMore()}>加载更多会话</Button>}
      {selected && <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: selected.cwd }}>
        工作目录：{selected.cwd}
      </Typography.Text>}
      {error && <Alert type="warning" showIcon title={error} />}
      <Radio.Group
        aria-label="已有会话投递方式"
        value={value.action}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, action: event.target.value })}
      >
        <Space direction="vertical" size={4}>
          <Radio value="open">打开会话并复制提示词，由我粘贴发送</Radio>
          <Radio value="queue">直接发送并处理（实验）</Radio>
        </Space>
      </Radio.Group>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        文字、图片和文件会复制到所选会话工作目录的 dihua-inbox/ 下，副本独立保留。下次会记住选择，投递前仍会询问。
      </Typography.Text>
    </>}
  </Space>
}
