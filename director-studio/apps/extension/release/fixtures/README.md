# Reviewer sample files

`review-sample.mp4`: four seconds of a procedural FFmpeg test pattern at 640×360, 30 fps, H.264 with 440 Hz AAC audio. `review-tone.wav`: four seconds of a generated 440 Hz tone, 48 kHz, stereo PCM16. These samples contain no private user media, account credentials or paid Fal result.

The source recorder is `../../scripts/record-review-demo.mjs`; the audio can be reproduced with `ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000 -t 4 -ac 2 -c:a pcm_s16le review-tone.wav`. FFmpeg is a development recording tool here; these generated media outputs are not codec binaries. Use the samples through the editor's file-picker upload, or through `import_url` only after a real public HTTPS source URL is available and verified.

These are sample data for the prepared review cases. A dedicated reviewer account, its own saved projects, native host case execution and an actual completed Fal receipt remain separate evidence. The browser-SDK recording does not record a ChatGPT conversation or model response.

The immutable public fixture URLs in P1 file_attachment_urls were fetched anonymously and match these exact bytes. Verification is ../evidence/public-review-materials.json. The public MP4 header is application/octet-stream; keep its .mp4 filename when downloading and use the file picker.
