import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, App as AntApp, Button, Card, Checkbox, Collapse, Flex, Layout, List, Result, Select, Space, Spin, Tag, Typography, theme } from 'antd'
import { FolderOpenOutlined, SendOutlined } from '@ant-design/icons'
import type { CodexDestination, JobDetail, JobStatus, ParseConfidence, Settings, TargetInfo } from '@shared/types'
import { TargetIcon } from '../components/TargetIcon'
import CodexConversationPicker from '../components/CodexConversationPicker'

const CONFIDENCE: Record<ParseConfidence, { color?: string; text: string }> = {
  high: { text: '已识别格式' },
  medium: { color: 'warning', text: '格式需核对' },
  low: { color: 'error', text: '未识别格式' },
}

/** 从微信递来一份记录后弹出的确认窗：看一眼、选目标、递出去。 */
export default function ConfirmPage(): React.JSX.Element {
  const { jobId = '' } = useParams()
  const { message } = AntApp.useApp()
  const { token } = theme.useToken()
  const [job, setJob] = useState<JobDetail | null | undefined>(undefined)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [targets, setTargets] = useState<TargetInfo[]>([])
  const [targetId, setTargetId] = useState('')
  const [remember, setRemember] = useState(false)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<{ name: string; nextStep: string; status?: JobStatus } | null>(null)
  const [codex, setCodex] = useState<CodexDestination>({ mode: 'new' })
  const [codexReady, setCodexReady] = useState(true)
  /** 递给当前所选目标时会带的上下文；目标不同措辞不同（ChatGPT 给路径，Gemini 说附件） */
  const [prompt, setPrompt] = useState<string>('')

  useEffect(() => {
    void (async () => {
      const [j, s, t] = await Promise.all([window.dihua.jobs.get(jobId), window.dihua.settings.get(), window.dihua.targets.list()])
      setJob(j ?? null)
      setSettings(s)
      if (s.codexDestination === 'existing') setCodex({ mode: 'existing', threadId: s.codexThreadId ?? '', action: s.codexExistingAction ?? 'open' })
      const usable = t.filter((x) => x.enabled)
      setTargets(usable)
      const preferred = usable.find((x) => x.id === s.defaultTargetId && x.available) ?? usable.find((x) => x.available) ?? usable[0]
      setTargetId(preferred?.id ?? '')
    })()
  }, [jobId])

  const target = useMemo(() => targets.find((t) => t.id === targetId), [targets, targetId])
  const targetLabel = target?.appName ?? target?.name ?? '目标应用'
  const viaClipboard = target?.capabilities.promptVia === 'clipboard'
  const existingCodex = targetId === 'codex' && codex.mode === 'existing'

  useEffect(() => {
    if (!targetId) return
    let alive = true
    void window.dihua.jobs.prompt(jobId, targetId).then((p) => {
      if (alive && p) setPrompt(p)
    })
    return () => {
      alive = false
    }
  }, [jobId, targetId])

  async function send(): Promise<void> {
    if (!target) return
    setSending(true)
    try {
      const res = await window.dihua.jobs.deliver(jobId, { targetId, rememberSkipConfirm: !existingCodex && remember,
        ...(targetId === 'codex' ? { codex } : {}) })
      if (res.ok) {
        setDone({ name: res.targetName, nextStep: res.nextStep, status: res.status })
        setTimeout(() => void window.dihua.app.closeWindow(), viaClipboard || existingCodex ? 5000 : 2400)
      } else message.error(res.error)
    } catch { message.error('投递未完成，请检查目标会话和记录后再重试。') }
    finally { setSending(false) }
  }

  async function cancel(): Promise<void> {
    await window.dihua.jobs.cancel(jobId)
    await window.dihua.app.closeWindow()
  }

  const closeButton = <Button onClick={() => window.dihua.app.closeWindow()}>关闭</Button>

  if (job === undefined || !settings) {
    return (
      <Flex align="center" justify="center" style={{ height: '100vh' }}>
        <Spin />
      </Flex>
    )
  }
  if (job === null) {
    return (
      <Layout style={{ height: '100vh' }}>
        <div className="drag-region" style={{ height: 38 }} />
        <Result status="404" title="找不到这条记录" extra={closeButton} />
      </Layout>
    )
  }
  if (done) {
    return (
      <Layout style={{ height: '100vh' }}>
        <div className="drag-region" style={{ height: 38 }} />
        <Result status="success" title={done.status === 'queued' ? '请求已排队' : done.status === 'prepared' ? '目标会话已打开' : `已递给 ${done.name}`} subTitle={`${done.name}。${done.nextStep}`} extra={closeButton} />
      </Layout>
    )
  }

  const meta: string[] = [`${job.counts.messages} 条`]
  if (job.nested?.records) meta.push(`含 ${job.nested.records} 段嵌套记录、${job.nested.messages} 条内层消息`)
  if (job.timeRange) meta.push(`${job.timeRange.start} 至 ${job.timeRange.end}`)
  if (job.counts.images) meta.push(`${job.counts.images} 张图片`)
  if (job.counts.videos) meta.push(`${job.counts.videos} 段视频`)
  if (job.counts.files) meta.push(`${job.counts.files} 个文件`)
  const confidence = CONFIDENCE[job.parseConfidence]

  return (
    <Layout style={{ height: '100vh' }}>
      <Flex className="drag-region" align="center" style={{ height: 38, flex: '0 0 38px', paddingInlineStart: 78 }}>
        <Typography.Text type="secondary" strong>
          递话
        </Typography.Text>
      </Flex>

      <Layout.Content style={{ overflow: 'auto', padding: '0 24px 16px' }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {job.title}
            </Typography.Title>
            <Space wrap style={{ marginTop: 6 }}>
              <Typography.Text type="secondary">{meta.join(' · ')}</Typography.Text>
              <Tag color={confidence.color}>{confidence.text}</Tag>
            </Space>
          </div>

          {job.parseConfidence === 'low' && <Alert type="warning" showIcon message="递话没认出这份记录的逐行格式，已把微信原文完整放进 transcript.md，AI 仍然可以读。" />}
          {!!job.nested?.unresolved && <Alert type="warning" showIcon message={`${job.nested.unresolved} 段嵌套记录未能完整展开，请查看 transcript.md 中的逐项说明。只有占位符时，可在微信打开该段记录，将内部消息另行转发。`} />}

          <Card
            size="small"
            title="预览"
            extra={<Button type="text" size="small" icon={<FolderOpenOutlined />} title="在 Finder 中显示" onClick={() => window.dihua.jobs.reveal(jobId)} />}
            styles={{ body: { maxHeight: 180, overflow: 'auto', paddingBlock: 0 } }}
          >
            <List
              className="selectable"
              size="small"
              dataSource={job.preview.slice(0, 80)}
              locale={{ emptyText: '没有可预览的消息' }}
              renderItem={(m) => (
                <List.Item>
                  <Space align="start">
                    <Typography.Text type="secondary" style={{ display: 'inline-block', width: 88, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                      {m.time?.slice(5) ?? ''}
                    </Typography.Text>
                    <Typography.Text strong>{m.sender}</Typography.Text>
                    <Typography.Text type={m.kind === 'text' ? undefined : 'secondary'} className="pre">
                      {m.text}
                    </Typography.Text>
                  </Space>
                </List.Item>
              )}
            />
          </Card>

          <Card size="small" title="递给">
            <Select
              value={targetId || undefined}
              disabled={sending}
              onChange={(v) => setTargetId(String(v))}
              placeholder="选择要递给的应用"
              style={{ width: '100%' }}
              optionLabelProp="label"
              options={targets.map((t) => ({
                value: t.id,
                disabled: !t.available,
                label: (
                  <Space>
                    <TargetIcon target={t} size={16} />
                    <span>{t.appName ?? t.name}</span>
                    {!t.available && <Typography.Text type="secondary">未安装</Typography.Text>}
                  </Space>
                ),
              }))}
            />
            {targetId === 'codex' && <CodexConversationPicker value={codex} onChange={setCodex} onReady={setCodexReady} disabled={sending} rememberedId={settings.codexThreadId} />}
            {target && (
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
                {target.description}
              </Typography.Text>
            )}
          </Card>

          <Collapse
            ghost
            size="small"
            items={[
              {
                key: 'prompt',
                label: existingCodex ? '本次会话投递说明' : viaClipboard ? `会复制到剪贴板、粘贴给 ${targetLabel} 的上下文` : `预填给 ${targetLabel} 的上下文`,
                children: (
                  <Typography.Paragraph className="selectable" style={{ margin: 0 }}>
                    <pre className="pre">{existingCodex
                      ? '将本批记录复制到所选会话的 dihua-inbox/，提示 Codex 阅读 transcript.md，并实际查看图片和文件。占位符及无法展开的嵌套记录会要求明确说明。'
                      : prompt || job.handoffPrompt}</pre>
                  </Typography.Paragraph>
                ),
              },
            ]}
          />
        </Space>
      </Layout.Content>

      <Layout.Footer style={{ padding: '12px 24px', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
        <Flex justify="space-between" align="center">
          {existingCodex ? <Typography.Text type="secondary">将记住本次会话选择</Typography.Text> : <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)}>
            下次不再询问，直接递给 {targetLabel}
          </Checkbox>}
          <Space>
            <Button disabled={sending} onClick={cancel}>取消</Button>
            <Button type="primary" icon={<SendOutlined />} loading={sending} disabled={!target?.available || (existingCodex && !codexReady)} onClick={send}>
              {existingCodex ? codex.action === 'queue' ? '发送到所选会话' : '打开所选会话' : `递给 ${targetLabel}`}
            </Button>
          </Space>
        </Flex>
      </Layout.Footer>
    </Layout>
  )
}
