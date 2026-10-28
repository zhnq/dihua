import React, { useEffect, useState } from 'react'
import { Button, Spin } from 'antd'
import { FileTextOutlined, FolderOpenOutlined, PictureOutlined, VideoCameraOutlined } from '@ant-design/icons'
import type { JobContent, JobDetail } from '@shared/types'

const sizeLabel = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

export default function ContentPreview({ job, active }: { job: JobDetail; active: boolean }): React.JSX.Element {
  const [content, setContent] = useState<JobContent>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!active || content) return
    let alive = true
    setError('')
    void window.dihua.jobs.content(job.id).then((result) => {
      if (!alive) return
      if (result) setContent(result)
      else setError('找不到这批内容，请重新导入。')
    }).catch(() => { if (alive) setError('内容暂时无法读取。原始记录仍保留在本地。') })
    return () => { alive = false }
  }, [job.id, active, retry, content])

  if (error) return <div className="list-state" role="alert"><span>{error}</span><Button onClick={() => setRetry((n) => n + 1)}>重试</Button><Button onClick={() => void window.dihua.jobs.reveal(job.id)}>在 Finder 中显示</Button></div>
  if (!content) return <div className="list-state" role="status"><Spin /><span>正在读取本次内容…</span></div>
  return <div className="content-preview">
    <section className="message-preview selectable" aria-label="聊天内容">
      <div className="preview-heading"><h2 title={job.title}>{job.title}</h2><span>{job.counts.messages} 条外层消息{job.nested?.messages ? ` · ${job.nested.messages} 条内层消息` : ''}</span></div>
      {job.timeRange && <p className="preview-time">{job.timeRange.start} 至 {job.timeRange.end}</p>}
      {content.messages.map((message, index) => <article key={index} className={`preview-message ${message.depth ? 'inner-message' : ''}`} style={{ marginLeft: Math.min(message.depth, 3) * 14 }}>
        <div className="message-meta"><strong>{message.sender ?? '微信原文'}</strong><time>{message.time}</time>{message.depth > 0 && <span>第 {message.depth} 层</span>}</div>
        <p>{message.text}</p>
        {message.nestedStatus && message.nestedStatus !== 'expanded' && <span className="content-warning">{message.nestedStatus === 'partial' ? '内部条数需核对' : message.nestedStatus === 'depth-limit' ? '达到解析深度上限，原文已保留' : '导出内容未包含可识别的内部正文'}</span>}
      </article>)}
      {content.truncated && <p className="preview-limit">此处仅展示部分内容，完整记录请查看 transcript.md。</p>}
    </section>
    <aside className="attachment-preview" aria-label="本次附件">
      <h2>附件 <span>{content.attachments.length}</span></h2>
      {content.attachments.length ? content.attachments.map((file) => <button key={file.path} className="attachment-row" title={`在 Finder 中显示：${file.name}`} onClick={() => {
        void window.dihua.jobs.revealAttachment(job.id, file.path).catch(() => setError('这个附件无法定位，请在记录目录中查看。'))
      }}>
        <span className="attachment-symbol">{file.kind === 'image' ? <PictureOutlined /> : file.kind === 'video' ? <VideoCameraOutlined /> : <FileTextOutlined />}{file.thumbnail && <img src={file.thumbnail} alt={`附件图片：${file.name}`} onError={(event) => { event.currentTarget.style.display = 'none' }} />}</span>
        <span className="attachment-copy"><strong>{file.name.replace(/^聊天记录内的图片、视频和文件_/, '')}</strong><small>{sizeLabel(file.bytes)}</small></span>
      </button>) : <p className="preview-time">本次没有随行附件</p>}
      <p className="attachment-help">选中附件可在 Finder 中定位，按空格快速查看。</p>
      <button className="text-action reveal-record" onClick={() => void window.dihua.jobs.reveal(job.id)}><FolderOpenOutlined /> 显示完整记录</button>
    </aside>
  </div>
}
