import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexReader, copyBatchToThread, describeCodexThread, existingThreadPrompt, findCodexExecutable, getCodexThread, listCodexThreads, queueCodexMessage } from '../src/main/codex'
import type { JobSummary } from '../src/shared/types'

const ID = '11111111-2222-4333-8444-555555555555'
const roots: string[] = []
function temporary(): string { const root = mkdtempSync(join(tmpdir(), 'dihua-codex-')); roots.push(root); return root }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fakeCli(body = ''): { executable: string; root: string } {
  const root = temporary()
  const executable = join(root, 'codex')
  writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs');
const argsFile = ${JSON.stringify(join(root, 'args.json'))};
fs.writeFileSync(argsFile, JSON.stringify(process.argv.slice(2)));
${body || `
if (process.argv[2] === 'queue') { console.log('Queued'); process.exit(0); }
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const r = JSON.parse(line);
  if (!r.id) return;
  fs.appendFileSync(${JSON.stringify(join(root, 'requests.jsonl'))}, JSON.stringify(r)+'\\n');
  const thread = {id:${JSON.stringify(ID)},name:'项目讨论',cwd:${JSON.stringify(root)},updatedAt:42};
  const result = r.method==='thread/list' ? {data:[thread,{id:'invalid',cwd:'/tmp'}],nextCursor:'next-page'} : r.method==='thread/read' ? {thread} : {};
  console.log(JSON.stringify({method:'notification/ignored'}));
  console.log(JSON.stringify({id:r.id,result}));
});`}
`, { mode: 0o755 })
  return { executable, root }
}

describe('Codex read-only protocol', () => {
  it('initializes, lists paginated desktop sessions, and never resumes a thread', async () => {
    const cli = fakeCli()
    const result = await listCodexThreads({ search: '项目', cursor: 'page-2' }, cli.executable)
    expect(result).toEqual({ threads: [{ id: ID, title: '项目讨论', cwd: cli.root, updatedAt: 42 }], nextCursor: 'next-page' })
    const requests = readFileSync(join(cli.root, 'requests.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(requests.map((r) => r.method)).toEqual(['initialize', 'thread/list'])
    expect(requests[1].params).toMatchObject({ searchTerm: '项目', cursor: 'page-2', sortKey: 'updated_at', archived: false, useStateDbOnly: true })
    expect(requests[1].params.sourceKinds).toContain('appServer')
    expect((await getCodexThread(ID, cli.executable)).cwd).toBe(cli.root)
  })

  it('rejects invalid thread IDs before starting a process', async () => {
    const cli = fakeCli()
    await expect(getCodexThread('--delete-all', cli.executable)).rejects.toThrow('有效')
    await expect(queueCodexMessage('name; $(touch nope)', 'x', cli.executable)).rejects.toThrow('有效')
    expect(existsSync(join(cli.root, 'args.json'))).toBe(false)
  })

  it('reports RPC errors, startup failure and timeout without hanging', async () => {
    const cli = fakeCli(`require('node:readline').createInterface({input:process.stdin}).on('line', l => {
      const r=JSON.parse(l); if(r.id) console.log(JSON.stringify({id:r.id,error:{message:'unsupported method'}}));
    });`)
    await expect(listCodexThreads({}, cli.executable)).rejects.toThrow('unsupported method')
    await expect(listCodexThreads({}, join(cli.root, 'missing'))).rejects.toThrow('无法启动')
    const quiet = fakeCli('setInterval(()=>{},1000)')
    const reader = new CodexReader(quiet.executable, [], 100)
    try { await expect(reader.initialize()).rejects.toThrow('超时') } finally { reader.close() }
  })

  it('accepts valid local threads, falls back to previews, excludes ephemeral / archived records', () => {
    const raw = { id: ID, cwd: '/project', preview: 'hello\nworld' }
    expect(describeCodexThread(raw)?.title).toBe('hello world')
    expect(describeCodexThread({ ...raw, ephemeral: true })).toBeUndefined()
    expect(describeCodexThread({ ...raw, archived: true })).toBeUndefined()
    expect(describeCodexThread({ ...raw, cwd: 'relative' })).toBeUndefined()
    expect(describeCodexThread(null)).toBeUndefined()
  })
})

describe('existing-thread delivery', () => {
  function batch(): { job: JobSummary; cwd: string } {
    const root = temporary()
    const source = join(root, 'source')
    const cwd = join(root, 'project')
    mkdirSync(join(source, '媒体'), { recursive: true }); mkdirSync(join(source, '文件'))
    mkdirSync(cwd)
    writeFileSync(join(source, 'transcript.md'), '正文')
    writeFileSync(join(source, '媒体', '照片.png'), Buffer.from([0, 255, 1, 2]))
    writeFileSync(join(source, '文件', '附件.txt'), '附件内容')
    writeFileSync(join(cwd, 'AGENTS.md'), 'existing project instructions')
    return { cwd, job: { id: 'job', title: '项目群', inboxDir: source, counts: { messages: 4, images: 1, files: 1, videos: 0, others: 1 } } as JobSummary }
  }

  it('copies text and binary attachments into a unique project subfolder, preserving project instructions', () => {
    const { job, cwd } = batch()
    const directory = copyBatchToThread(job, cwd)
    expect(readFileSync(join(directory, '媒体', '照片.png'))).toEqual(Buffer.from([0, 255, 1, 2]))
    expect(readFileSync(join(directory, '文件', '附件.txt'), 'utf8')).toBe('附件内容')
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe('existing project instructions')
    expect(copyBatchToThread(job, cwd)).not.toBe(directory)
    const prompt = existingThreadPrompt(job, directory, cwd)
    expect(prompt).toContain('dihua-inbox/wechat-')
    expect(prompt).toContain('实际查看')
    expect(prompt).toContain('嵌套聊天记录')
    expect(existingThreadPrompt(job, directory, cwd, '提取待办')).toContain('用户对本批记录的要求：\n提取待办')
    expect(prompt).not.toContain(job.inboxDir)
  })

  it('refuses links, recursive copy, missing workspace and incomplete batches', () => {
    const { job, cwd } = batch()
    expect(() => copyBatchToThread(job, join(cwd, 'missing'))).toThrow('已不存在')
    expect(() => copyBatchToThread(job, job.inboxDir)).toThrow('自身')
    symlinkSync(job.inboxDir, join(cwd, 'dihua-inbox'))
    expect(() => copyBatchToThread(job, cwd)).toThrow('符号链接')
    rmSync(join(cwd, 'dihua-inbox'))
    symlinkSync(join(cwd, 'AGENTS.md'), join(job.inboxDir, 'link'))
    expect(() => copyBatchToThread(job, cwd)).toThrow('符号链接')
    expect(readdirSync(join(cwd, 'dihua-inbox'))).toEqual([])
    rmSync(join(job.inboxDir, 'link')); rmSync(join(job.inboxDir, 'transcript.md'))
    expect(() => copyBatchToThread(job, cwd)).toThrow()
    expect(readdirSync(join(cwd, 'dihua-inbox'))).toEqual([])
  })

  it('passes message and UUID as individual arguments without shell interpolation', async () => {
    const cli = fakeCli()
    const message = '读取 "带 空格/照片"；$(touch SHOULD_NOT_EXIST)\n保留换行'
    await queueCodexMessage(ID, message, cli.executable)
    expect(JSON.parse(readFileSync(join(cli.root, 'args.json'), 'utf8'))).toEqual(['queue', '--thread', ID, '--message', message])
    const failure = fakeCli('console.error("daemon unavailable"); process.exit(1)')
    await expect(queueCodexMessage(ID, message, failure.executable)).rejects.toThrow('未确认排队成功')
  })

  it('finds executables without a shell, rejecting relative PATH entries', () => {
    const root = temporary()
    const bin = join(root, '.local', 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'codex'), '#!/bin/sh\nexit 0', { mode: 0o755 })
    expect(findCodexExecutable({ PATH: './relative' }, root)).toBe(join(bin, 'codex'))
  })
})
