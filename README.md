# Speech Notes

A local browser UI for continuous Azure Speech-to-Text. Includes live partial results, timestamped final text, Cantonese/Mandarin/English language selection, browser-local session history, and copy/TXT/JSON export. Start again after stopping to append to the current session.

## Run

Requires Node.js 22 or newer.

Quick start:

```sh
./start.sh
```

The script works from any directory, installs missing dependencies, builds the UI, and starts the server. On first use without credentials, it creates `.env` for you to fill in. Press **Ctrl+C** to stop.

Manual setup:

```sh
npm install
cp .env.example .env
# Add your Azure Speech resource key and region to .env
npm run build
npm start
```

Open **http://localhost:3030**, select the spoken language, and click **Start recording**. Allow microphone access. Use **Stop recording** to finish the transcript. The Azure key stays on the local server; the browser receives a short-lived token, renewed during long sessions.

`ENABLE_AZURE_TTS` is not needed: this app uses speech-to-text. The resource/key must support Azure Speech recognition, even if it was originally provisioned for TTS.

## Data and access

Audio is streamed to Microsoft Azure for recognition. This app does not save raw audio. Completed text is saved in localStorage in the current browser profile. Export important transcripts; clearing browser data removes local sessions. Private browsing and storage limits may prevent saving. Partial text is a preview and is saved only when Azure finalizes it. Speech recognition may omit or mishear words.

Keep the tab open while recording. Interruptions are reported; completed text is retained. Microphone access works on localhost or HTTPS. Tested API behavior uses mocked Azure responses; actual recognition needs a microphone and valid Azure service access.

The server binds to loopback by default and restricts token issuance to localhost. It is intended for local personal use. Remote hosting needs HTTPS, authenticated/rate-limited token issuance, and a server-side secret configured by the host. Do not publish `.env` or put the key in browser JavaScript. Generated `public/app.js` and `.env` are ignored by Git.

## Validation

```sh
npm test
npm run build
```

Azure SDK references: [continuous recognition](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-recognize-speech?pivots=programming-language-javascript) and [token management](https://learn.microsoft.com/en-us/javascript/api/microsoft-cognitiveservices-speech-sdk/speechconfig).
