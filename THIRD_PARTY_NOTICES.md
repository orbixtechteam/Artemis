# Third-party notices

Artemis is released under the [GNU AGPL-3.0](LICENSE). It uses the open-source software and models below. Each project keeps its own license; the full texts ship with the packages in `node_modules` and in the built app.

## Libraries in the app

| Package | Version | License |
| --- | --- | --- |
| react, react-dom | 18.3.1 | MIT |
| react-markdown | 9.1.0 | MIT |
| remark-gfm | 4.0.1 | MIT |
| rehype-highlight | 7.0.2 | MIT |
| highlight.js | 11.12.0 | BSD-3-Clause |
| @xterm/xterm | 5.5.0 | MIT |
| @xterm/addon-fit | 0.10.0 | MIT |
| @xterm/addon-web-links | 0.11.0 | MIT |
| jszip | 3.10.2 | MIT or GPL-3.0-or-later (used under MIT) |
| mammoth | 1.13.0 | BSD-2-Clause |
| pdf-parse | 1.1.4 | MIT |
| xlsx (SheetJS) | 0.20.3 | Apache-2.0 |
| vosk-browser | 0.0.8 | Apache-2.0 |
| onnxruntime-node | 1.30.0 | MIT |

## Build and development tools

Electron 33 (MIT), electron-builder (MIT), Vite (MIT), @vitejs/plugin-react (MIT), concurrently (MIT), cross-env (MIT), wait-on (MIT).

## Models and data you download

These are not part of the repository. Artemis downloads them only when you ask for the feature.

| Model | Used for | License |
| --- | --- | --- |
| WeSpeaker CAM++ (`wespeaker_en_voxceleb_CAM++`, via sherpa-onnx releases) | Speaker recognition (Settings → Security) | CC BY 4.0 |
| Vosk small English model (`vosk-model-small-en-us-0.15`) | Sentinel speech recognition | Apache-2.0 |

Voices for Piper, Kokoro or Chatterbox servers you run yourself each carry their own license; check it before you redistribute audio.

## Trademarks

Artemis is independent and is not affiliated with Anthropic, OpenAI, Apple, Telegram, Make or any other company named in the app. Their names are used only to say what Artemis can connect to.

This list was written from `package.json` and the installed packages. If you find a mistake, please open an issue.
