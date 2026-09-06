# Douyin Digest

English | [简体中文](README.zh-CN.md)

Read timestamped Chinese transcripts beside desktop Douyin videos, distinguish speakers within an episode, search spoken content, generate an overview, explain selections, take notes, and save the results to a local folder you choose.

This is an independent derivative of Zara Zhang's [YouTube Digest](https://github.com/zarazhangrui/youtube-digest). The original MIT license and copyright notice are preserved. Douyin page support, audio transcription, speaker presentation, and the local reading library are maintained independently by this project. It is not affiliated with or endorsed by Douyin.

## What it does

- Uses readable captions when available, or submits the complete public-video audio track to Volcengine Speech when transcription is requested.
- Shows sentence timestamps and episode-local labels such as Speaker 1 and Speaker 2, with optional names for that video.
- Supports transcript search, timestamp seeking, follow-along reading, AI overviews, selected-text explanations, and timestamped notes.
- Provides a local library that saves transcripts, overviews, and notes as Markdown under a folder chosen by the user.
- Stores keys, settings, recent results, and notes in the current Chrome extension profile. The project operates no relay server, analytics, or telemetry.

## Install

Google Chrome 116 or newer is required.

1. Download the source ZIP from GitHub and extract it to a folder you will keep.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the project folder containing `manifest.json`.
4. Open Settings and enter your own provider API keys. Never put keys in source files, chats, screenshots, issues, or pull requests.
5. Open a public Douyin video and click the Douyin Digest page button or extension icon.

After updating the source, reload the Douyin Digest card on the extensions page and refresh open Douyin tabs. Do not uninstall merely to update; uninstalling may remove local extension data.

## Providers

- Volcengine Speech transcribes videos without usable captions and returns timestamps and episode-local speaker labels. Select a recording-recognition version actually enabled for your account. Usage may be billed.
- DeepSeek generates overviews and selected-text explanations.
- Supadata remains an optional transcript provider. Availability and pricing are controlled by the provider.

The extension includes no API credit. Provider data handling and fees remain subject to each provider's terms.

## Speaker labels

Speaker labels group voices within the current recording. They are not face recognition and do not create a cross-video identity. Overlapping speech, poor audio, or similar voices may reduce accuracy. Verify important quotations by seeking to the timestamp.

## Local library

Open **My Library** from the side panel or from Settings. Choose a root folder, then save all items or one video. Files are organized as:

```text
Chosen folder/
└── Douyin/
    └── Video title [video ID]/
        ├── Transcript.md
        ├── Overview.md
        └── Notes.md
```

Identical content is not written twice. Changed content is saved as a numbered copy without overwriting older files. Browser library entries and disk files are not automatically synchronized; files are written only after an explicit save action.

## Supported scope

The project targets public desktop Douyin video pages and search or creator overlays where the current video ID is available. It does not promise support for infinite-feed home pages, live streams, private or restricted videos, mobile browsers, or other short-video platforms.

Long videos require the complete audio track to be read and prepared. Processing time depends on duration, network conditions, and the speech provider. Closing or reloading the browser can interrupt an active job. Preserve the error shown for an uncertain job instead of repeatedly resubmitting it.

## Privacy, security, and contributing

Read [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [CONTRIBUTING.md](CONTRIBUTING.md). Public source and releases must not include API keys, browser profiles, transcripts, personal notes, private media, or paid-account data.

Run the project checks before contributing:

```bash
npm test
npm run check
npm run check:public
npm run package
```

See [CHANGELOG.md](CHANGELOG.md) for releases and [NOTICE.md](NOTICE.md) for attribution and third-party licensing.

## License

MIT. See [LICENSE](LICENSE). The original copyright and license notice must be retained.
