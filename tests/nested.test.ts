import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_NESTED_DEPTH, parseTranscript } from '../src/main/parse'
import { renderTranscriptMarkdown } from '../src/main/workspace'
import { describeNested } from '../src/main/handoff'

const parse = (text: string, mediaFiles: string[] = []) => parseTranscript({ text, mediaFiles, fallbackTitle: '测试' })
const block = (sender: string, body: string) => `·${sender}\n2026年10月28日 12:00\n${body}\n`
const indent = (text: string, prefix = '    ') => text.split('\n').map((line) => line ? prefix + line : '').join('\n')

describe('微信缩进嵌套聊天记录', () => {
  it('真实导出结构的脱敏复现：7 条外层 + 7 条内层，保持转发关系和各自时间', () => {
    const t = parse(readFileSync(join(__dirname, '../fixtures/wechat-nested.txt'), 'utf8'))
    expect(t.messages).toHaveLength(7)
    expect(t.messages[0]).toMatchObject({ sender: '转发人甲', kind: 'nested', nestedStatus: 'expanded', time: '2026-10-28 22:41' })
    expect(t.messages[0].children).toHaveLength(7)
    expect(t.messages[0].children![0]).toMatchObject({ sender: '内层甲', time: '2026-10-28 22:31', text: '第一条内部消息' })
    expect(t.messages[1].text).toBe('外层回复一')
    expect(t.title).toBe('转发人甲、转发人乙')
    expect(t.timeRange).toEqual({ start: '2026-10-28 22:41', end: '2026-10-28 22:47' })
    expect(t.nested).toEqual({ records: 1, messages: 7, unresolved: 0 })
    const md = renderTranscriptMarkdown(t, [])
    expect(md).toContain('> **内层甲** 2026-10-28 22:31')
    expect(md).toContain('> 第一条内部消息')
    expect(md).toContain('**转发人甲** 22:42\n外层回复一')
  })

  it('多层嵌套、同层兄弟记录、内层图片和文件均保留，内外 footer 独立统计', () => {
    const deep = block('深层', '[图片] pic.png\n第二行说明') + block('深层', '[文件] note.txt') + '以上为分享的2条聊天记录\n'
    const inner = block('内层', '[聊天记录]\n' + indent(deep)) + block('内层', '内层结束') + '以上为分享的2条聊天记录\n'
    const text = block('外层', '[聊天记录]\n' + indent(inner)) + block('外层', '[聊天记录]\n' + indent(block('另一个内层', '独立消息'))) + '以上为分享的2条聊天记录\n'
    const t = parse(text, ['附件/pic.png', '附件/note.txt'])
    expect(t.messages).toHaveLength(2)
    expect(t.declaredCount).toBe(2)
    expect(t.parseConfidence).toBe('high')
    expect(t.nested).toEqual({ records: 3, messages: 5, unresolved: 0 })
    expect(t.counts).toMatchObject({ messages: 2, images: 1, files: 1 })
    const children = t.messages[0].children![0].children!
    expect(children[0]).toMatchObject({ mediaFile: '附件/pic.png', text: '[图片] pic.png\n第二行说明' })
    expect(children[1].mediaFile).toBe('附件/note.txt')
    const md = renderTranscriptMarkdown(t, [])
    expect(md).toContain('> > **深层** 2026-10-28 12:00')
    expect(md).toContain('> > 第二行说明')
    expect(md).toContain('> 独立消息')
  })

  it('只有占位符或无可识别正文时不伪造内部消息，并提示补充转发', () => {
    const t = parse(block('外层', '[聊天记录] 标题和摘要\n没有内部发言人和时间'))
    expect(t.messages[0]).toMatchObject({ nestedStatus: 'unavailable', text: '[聊天记录] 标题和摘要\n没有内部发言人和时间' })
    expect(t.messages[0].children).toBeUndefined()
    expect(t.nested).toEqual({ records: 1, messages: 0, unresolved: 1 })
    const md = renderTranscriptMarkdown(t, [])
    expect(md).toContain('没有内部发言人和时间')
    expect(md).toContain('请在微信打开这段聊天记录')
    expect(describeNested(t)).toContain('不要推测内部正文')
  })

  it('内层消息再多也不会覆盖外层的格式判定', () => {
    const inner = Array.from({ length: 50 }, (_, i) => block(`内层${i}`, '正文')).join('\n')
    const t = parse('2026-10-28 13:00 外层\n[聊天记录]\n' + indent(inner))
    expect(t.format).toBe('time-first')
    expect(t.messages).toHaveLength(1)
    expect(t.messages[0].children).toHaveLength(50)
  })

  it('内层标题、摘要保留，内层声明条数不符时显式提示且不覆盖外层声明', () => {
    const inner = '内部群聊的聊天记录\n摘要：请核对这部分\n\n' + block('内层', '正文') + '以上为分享的3条聊天记录\n'
    const t = parse(block('外层', '[聊天记录]\n' + indent(inner)) + '以上为分享的1条聊天记录\n')
    expect(t.declaredCount).toBe(1)
    expect(t.messages[0]).toMatchObject({ nestedStatus: 'partial', nestedDeclaredCount: 3 })
    expect(t.nested).toEqual({ records: 1, messages: 1, unresolved: 1 })
    const md = renderTranscriptMarkdown(t, [])
    expect(md).toContain('> 摘要：请核对这部分')
    expect(md).toContain('内层条数需核对：声明 3 条，识别 1 条')
    expect(md).toContain('微信声明共 1 条记录')
  })

  it('普通消息里的缩进时间片段不会被误作外层消息或自动展开', () => {
    const t = parse(block('外层', '这是示例文本\n' + indent(block('引用', '内容'))))
    expect(t.messages).toHaveLength(1)
    expect(t.messages[0].kind).toBe('text')
    expect(t.messages[0].children).toBeUndefined()
    expect(t.messages[0].text).toContain('·引用')
  })

  it('支持制表符、全角空格和内层时间在前的格式', () => {
    for (const prefix of ['\t', '\u3000\u3000', '    ']) {
      const t = parse(block('外层', '[聊天记录]\n' + indent('2026-10-28 11:00 内层\n文字\n第二行', prefix)))
      expect(t.messages[0].children?.[0]).toMatchObject({ sender: '内层', text: '文字\n第二行' })
    }
  })

  it('深度上限处保留原文并报告限制，不静默截断', () => {
    let text = block('最深层', '最深层校验内容')
    for (let i = 0; i < MAX_NESTED_DEPTH + 2; i++) text = block('外层', '[聊天记录]\n' + indent(text))
    const t = parse(text)
    expect(t.nested?.unresolved).toBe(1)
    const md = renderTranscriptMarkdown(t, [])
    expect(md).toContain('达到嵌套解析深度上限')
    expect(md).toContain('最深层校验内容')
  })

  it('同名附件需要明确路径，不能把不同层的图片错连', () => {
    const t = parse(block('外层', '[聊天记录]\n' + indent(block('内层', '[图片] x.png') + block('内层', '[图片] b/x.png'))), ['a/x.png', 'b/x.png'])
    expect(t.messages[0].children![0].mediaFile).toBeUndefined()
    expect(t.messages[0].children![1].mediaFile).toBe('b/x.png')
  })
})
