# Video pipeline (Phase 4, not yet built)

What this folder will hold, and the one thing settled now: the cut list format. Agreeing it first lets the `video-editor` skill and the renderer be built independently.

## The personal flow

1. The Repurpose agent delivers the script (`long_script` asset). Jitaksh records against it.
2. Raw clips go into a Google Drive folder named for the video.
3. The worker (`video/worker/`) downloads them, runs auto-editor to remove silences, transcribes with faster-whisper large-v3-turbo (the Hinglish model when marked Hindi) with word timestamps, and saves the transcript as a `transcript` asset.
4. The `video-editor` skill compares transcript and script and writes a cut list (`cut_list` asset) in the format below.
5. The renderer executes the cut list with FFmpeg: long video, shorts with word-by-word captions, thumbnail from the HTML template.
6. Preview link in Slack. Approve or reply with changes.
7. The YouTube sender uploads with title, description, chapters, thumbnail and schedule; shorts queue for LinkedIn.

## Stack decisions (from the build guide)

- FFmpeg, auto-editor, faster-whisper on the server, one job at a time, memory under 4 GB.
- HyperFrames for intro, outro, lower-thirds, title cards, captions style and the faceless videos. Not Remotion.
- Kokoro for English narration on the faceless channel, ElevenLabs for Hindi or expressive reads.
- OpenShorts or AutoClip for speaker-tracked vertical reframing, else a face-detect crop in FFmpeg.
- YouTube: tick the altered-content box when a video shows synthetic people or voices. One video a week, each with original analysis.

## Cut list format

`cut-list.schema.json` is the contract. A cut list is JSON with:

- `source`: the input file and its transcript asset id
- `keep`: ordered segments `{start, end, label?}` in seconds from the silence-cut file
- `titles`: `{at, duration, text, style: "title"|"lower_third"|"chapter"}`
- `zooms`: `{at, duration, scale}` for emphasis
- `captions`: `{style: "word"|"line", font_size}` applied to shorts always and to the long video when asked
- `shorts`: up to five `{start, end, hook, title}` picked from `keep`
- `chapters`: `{at, title}` for the YouTube description
- `thumbnail`: `{frame_at, layout: "a"|"b"|"c", headline}`

## Folders to create in Phase 4

| Folder | Holds |
|---|---|
| `video/worker/` | Drive watcher, auto-editor and whisper runner, transcript writer |
| `video/render/` | Cut list executor (FFmpeg), captions, shorts, thumbnail |
| `video/brand/` | HyperFrames kit: intro, outro, lower-third, title card, caption style, thumbnail template |
| `video/faceless/` | Script to narration (Kokoro), visuals (HyperFrames), Pexels stock with credit, assembly |
