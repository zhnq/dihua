<p align="center">
  <img src="docs/assets/icon-256.png" width="120" alt="Dihua icon">
</p>

<h1 align="center">Dihua · 递话</h1>

> First, thank you to [ZHlovecat/dihua](https://github.com/ZHlovecat/dihua) and its author [@ZHlovecat](https://github.com/ZHlovecat) for making Dihua open source. The WeChat share extension, export-to-workspace pipeline, and multi-app handoff build on that work. This community fork focuses on Codex conversation selection, nested records, and transfer confirmation, while retaining the original MIT license and copyright notice.

<p align="center">
  <b>Hand your WeChat chats to any AI.</b><br>
  Forward messages from WeChat for Mac, then hand the text, images and files to Codex, Claude or Gemini in a readable workspace.
</p>

<p align="center">
  <b>English</b> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/zhnq/dihua/releases"><img src="https://img.shields.io/github/v/release/zhnq/dihua?label=release" alt="Fork release"></a>
  <img src="https://img.shields.io/badge/platform-macOS%2013%2B-blue" alt="macOS 13+">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/zhnq/dihua" alt="MIT"></a>
</p>

## Download 0.0.5

**[Download for Apple Silicon (arm64 DMG)](https://github.com/zhnq/dihua/releases/download/v0.0.5/Dihua-0.0.5-arm64.dmg)** · [0.0.5 release notes](https://github.com/zhnq/dihua/releases/tag/v0.0.5) · [SHA-256 checksum](https://github.com/zhnq/dihua/releases/download/v0.0.5/Dihua-0.0.5-arm64.dmg.sha256)

For Apple Silicon Macs running macOS 13 or later. **This release provides an arm64 installer only; an Intel x64 build is not included.** See [Install](#install) for setup.

## What this fork changes

The upstream project provides the complete flow from WeChat sharing and ZIP extraction to a local workspace and multiple AI apps. Version 0.0.5 unifies glass materials across the main window and share dialog, and fixes Escape handling in the target menu. This table summarizes the fork’s enhancements over upstream:

| Change | Behavior in 0.0.5 |
|---|---|
| **Consistent glass interface** | General, Entries, Targets, History, About and the share dialog use the same materials, typography and controls, with light/dark appearance, narrow-window layouts and reduced-transparency support. |
| **Choose an existing Codex conversation** | Search conversations, choose a recent one or start a new one. Existing destinations receive an independent batch copy in their workspace. |
| **Preserve nested chat records** | Parse indentation recursively, retaining inner speakers, timestamps and attachment links. Count outer and inner messages separately. |
| **Redesigned confirmation window** | Keep the source summary and destination prominent, with search and preview on demand. Support keyboard selection, Command-Return, dark appearance and reduced motion. |
| **Per-handoff notes** | Add a task such as summarizing or extracting action items. The note travels with this batch and is not saved as a default task. |
| **Content and attachment preview** | Inspect message hierarchy, real photo thumbnails and files. Locate an attachment in Finder and press Space for Quick Look. |
| **Clear status and recovery** | Distinguish waiting for paste from queued. Copy again or reopen the destination without resubmitting. Report missing content and parsing limits. |

Existing conversations default to **Copy and open conversation** so you can paste, review and send. Direct queue submission remains experimental in Transfer Options. See [Codex conversation usage and requirements](docs/codex-conversations.md) for details.

## Updated interface

These are actual 0.0.5 screenshots from an isolated demo environment with synthetic chat content. The warning demonstrates an export containing a nested placeholder without its internal body.

**The main window: soft glass materials with clear content cards.**

<p align="center">
  <img src="docs/assets/screenshots/v0.0.5-general.jpg" width="780" alt="0.0.5 General page with a glass sidebar, unified titlebar, appearance picker and settings cards">
</p>

**Compact confirmation: review the batch and destination before handing it over.**

<p align="center">
  <img src="docs/assets/screenshots/v0.0.5-confirm.jpg" width="560" alt="0.0.5 compact confirmation with source summary, destination, optional note and copy-and-open action">
</p>

<details>
<summary>More screenshots: conversation search, content preview and optional notes</summary>

**Search an existing Codex conversation or create a new one.**

<p align="center">
  <img src="docs/assets/screenshots/v0.0.5-conversations.jpg" width="560" alt="0.0.5 conversation search showing a matching conversation and the new-conversation action">
</p>

**Expand the batch to review messages, photos, files and content notices.**

<p align="center">
  <img src="docs/assets/screenshots/v0.0.5-content.jpg" width="760" alt="0.0.5 content preview with messages, real photo thumbnail, file list and a missing-body notice">
</p>

**Add instructions for this handoff only.**

<p align="center">
  <img src="docs/assets/screenshots/v0.0.5-note.jpg" width="560" alt="0.0.5 optional note field for instructions before handoff">
</p>

</details>

<details>
<summary>More main-window views: dark appearance, History and About</summary>

**Dark appearance keeps the same materials and reading hierarchy.**

<p align="center">
  <img src="docs/assets/screenshots/v0.0.5-general-dark.jpg" width="780" alt="0.0.5 dark General page with neutral glass surfaces, readable text and blue selection">
</p>

**History: forward from WeChat or drag in an exported ZIP.**

<p align="center">
  <img src="docs/assets/screenshots/v0.0.5-history.jpg" width="780" alt="0.0.5 History page showing the empty state in an isolated demo environment">
</p>

**About: check your version, updates and file locations.**

<p align="center">
  <img src="docs/assets/screenshots/v0.0.5-about.jpg" width="780" alt="0.0.5 About page with branding, current version and update controls">
</p>

</details>

## Why Dihua

<p align="center">
  <img src="docs/assets/hero.svg" width="960" alt="WeChat → Dihua → ChatGPT / Claude / Gemini">
</p>

WeChat for Mac (4.1.13+) can export selected messages to other apps as a ZIP. Dihua receives that export through a macOS Share Extension, organizes the messages and attachments locally, and prepares a handoff to your AI app, saving the manual extraction and file organization.

- **Start from WeChat.** Multi-select → Forward → Other apps → *Dihua*, then confirm the destination.
- **The AI can actually read it.** The ZIP becomes a local workspace: `transcript.md` retains message order, speakers and nested structure, with separate media/files and `meta.json` metadata. Each target receives the format it supports.
- **You stay in charge.** Add your task in the confirmation window or continue in the AI app. Existing Codex conversations default to manual paste, review and send.
- **Nothing leaves your Mac through Dihua.** No accounts, no servers, no telemetry. The AI apps talk to their own backends exactly as they always do.

## How it works

<p align="center">
  <img src="docs/assets/screenshots/v0.0.5-entries.jpg" width="780" alt="0.0.5 Entries page with WeChat sharing status and usage steps">
</p>

1. **Turn on the entry.** Dihua registers a macOS Share Extension; WeChat's *Forward → Other apps → Choose an app on this Mac* lists it.
2. **Forward from WeChat.** Multi-select any messages — text, images, videos, files — and forward them to *Dihua*.

   <p align="center">
     <img src="docs/assets/screenshots/wechat-forward-menu.png" width="640" alt="WeChat: Forward to other apps → Choose an app on this Mac → Dihua">
   </p>

3. **Confirm the destination.** Review the summary, choose a Codex conversation, and optionally expand the preview or add a note.
4. **Hand off and send.** For an existing Codex conversation, choose **Copy and open conversation**, then press Command-V in the destination, review and press Return. For a new conversation or another target, follow the completion view's instructions.

The original **Send directly** setting remains available for new conversations and other targets. Existing Codex destinations always show confirmation.

## Transfer confirmation

The compact confirmation window keeps the source summary and destination visible, with content preview, conversation search, optional notes and transfer options available on demand. Choose a recent or existing Codex conversation, or start a new one. Use arrow keys and Return in search, Escape to return (or close an open target menu without cancelling the batch), and Command-Return to hand off from the note field.

Existing conversations default to copying the prompt and opening the selected conversation for you to paste, review and send. Experimental direct queue submission is in Transfer Options. Persistent feedback distinguishes prepared from queued; copying again and reopening the destination do not resubmit. Notes apply to this handoff only. Content preview preserves nesting and shows real attachments; locate an attachment in Finder and press Space for Quick Look.

## Nested chat records

Indented chat records inside forwarded messages are parsed recursively. `transcript.md` preserves the forwarding hierarchy, inner timestamps and speakers as block quotes, with links to inner images and files.

The main message count covers the outer level; inner messages are counted separately. `transcript.json` stores the structured result and `meta.json` includes nesting statistics. Placeholders, mismatched inner counts and the 16-level parsing limit are reported, with exported source text retained. Content absent from WeChat's export cannot be recovered; open that record in WeChat and forward its internal messages separately. Recognizing the format does not establish content completeness.

The fix applies to newly imported batches; existing batches are not rewritten automatically.

## Supported targets

| Target | How the record arrives |
|---|---|
| **Codex (ChatGPT desktop)** | Opens a new conversation with a pre-filled prompt, or copies the batch into a selected existing conversation's workspace. Codex reads `transcript.md` and the attachments. |
| **Claude desktop (Cowork)** | Opens a new Cowork task with the workspace folder attached and the prompt pre-filled. |
| **Gemini desktop** | Drops `transcript.md` and up to 9 images/files into the composer as attachments; the prompt is copied to your clipboard — paste and send. |

<p align="center">
  <img src="docs/assets/screenshots/v0.0.5-targets.jpg" width="760" alt="0.0.5 Targets page with app detection, default destination and switches">
</p>

## Install

1. Download [Dihua-0.0.5-arm64.dmg](https://github.com/zhnq/dihua/releases/download/v0.0.5/Dihua-0.0.5-arm64.dmg), open it, and drag *Dihua.app* into *Applications*.
2. The app is ad-hoc signed and has not been notarised by Apple. If macOS blocks the first launch, verify the download source and follow the system's security prompts to allow opening it manually.
3. Launch Dihua once. It registers the share entry automatically; if WeChat's menu still doesn't show it, enable *Dihua* under *System Settings → General → Login Items & Extensions → Extensions → Sharing*.

**Requirements:** macOS 13 Ventura or later · WeChat for Mac 4.1.13 or later · at least one of ChatGPT, Claude or Gemini desktop apps.

Existing Codex conversation selection also requires a working local Codex CLI; creating a new conversation does not. See the [usage guide](docs/codex-conversations.md).

To verify the installer, download the [DMG](https://github.com/zhnq/dihua/releases/download/v0.0.5/Dihua-0.0.5-arm64.dmg) and [checksum file](https://github.com/zhnq/dihua/releases/download/v0.0.5/Dihua-0.0.5-arm64.dmg.sha256) into the same directory, then run:

```sh
shasum -a 256 -c Dihua-0.0.5-arm64.dmg.sha256
```

**Updates:** *About → Check for updates* reads [this fork's Releases](https://github.com/zhnq/dihua/releases) and links to the download. Dihua also checks once a day on launch and notifies you when a new version is out.

## What you get on disk

```
~/Documents/dihua/
└── inbox/20260907-231000-Project group/
    ├── transcript.md     # message order, speakers, nesting and attachment links
    ├── transcript.json   # structured messages and nesting relationships
    ├── meta.json         # counts, time range, parse confidence and nesting summary
    ├── 媒体/             # images & videos (+ .thumb.png for videos)
    ├── 文件/             # other attachments
    └── 原始/             # the original zip and txt from WeChat
```

Records are listed in Dihua's *History*; you can re-send, reveal in Finder, or delete them (with files). Auto-cleanup is configurable.

## Acknowledgements

Thanks to [ZHlovecat/dihua](https://github.com/ZHlovecat/dihua) and its author for the upstream work, and to the [LINUX DO](https://linux.do/) community for support and feedback. The original license and copyright notice remain in [LICENSE](LICENSE).

## License

[MIT](LICENSE) © 2026 zhanghang
