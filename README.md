# NotifyBot

WhatsApp notification gateway built on [Baileys](https://github.com/WhiskeySockets/Baileys).

Links a personal WhatsApp account over the multi-device protocol and exposes a
single HTTP endpoint so other services can push text notifications into a chat.
No browser, no Puppeteer.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `API_KEY` | yes | Shared secret required on every request |
| `PHONE_NUMBER` | yes | The bot's own number, international format, digits only (e.g. `923001234567`) |
| `PORT` | no | HTTP port, defaults to `3000` |
| `AUTH_DIR` | no | Credential directory, defaults to `/data/auth` |
| `PAIRING_CODE` | no | Pin a custom 8-character pairing code (A-Z, 0-9) instead of a random one |

## Pairing

There is no QR code. On first start the bot prints an 8-character pairing code:

```
============================================================
  PAIRING CODE: ABCD1234
============================================================
```

On your phone, open WhatsApp and go to **Settings → Linked Devices → Link a
Device → "Link with phone number instead"**, then enter that code.

> Requesting a code does **not** send a notification to your phone. Read the
> code from the container logs (`docker logs -f notifybot`).

Credentials persist in `AUTH_DIR` (the `/data` volume), so restarts reconnect
without pairing again. If the session is revoked or logged out, the bot wipes
the stale credentials and prints a **fresh pairing code** automatically rather
than dying silently.

## API

### `POST /send`

Parameters are read from the JSON body or the query string.

| Field | Required | Description |
| --- | --- | --- |
| `apiKey` | yes | Must match `API_KEY` |
| `chatId` | yes | WhatsApp JID — `<number>@s.whatsapp.net` for a user, `<id>@g.us` for a group |
| `message` | yes | Text to send |

```bash
curl -X POST http://localhost:3000/send \
  -H 'Content-Type: application/json' \
  -d '{"apiKey":"secret","chatId":"923001234567@s.whatsapp.net","message":"hello"}'
```

Responses use a fixed envelope:

```json
{ "success": true, "message": "Sent message successfully", "data": {} }
```

| Status | Meaning |
| --- | --- |
| `200` | Sent |
| `400` | Missing `apiKey`, missing `chatId`/`message`, or a malformed `chatId` |
| `401` | Invalid `apiKey` |
| `503` | WhatsApp not connected yet — retry shortly |
| `500` | Send failed |

## Migrating from the whatsapp-web.js version

- **Text only.** `imageUrl`, `imageBase64`, `mimeType` and `filename` are gone.
- **`chatId` must be a Baileys JID.** The old `@c.us` suffix is rejected; users
  are `@s.whatsapp.net`.
- **The group chat-ID responder is gone.** Mentioning the bot in a group no
  longer replies with that group's ID.
- **Re-pairing is required once.** Session formats are not compatible, so old
  `/data` session files are inert and can be deleted. New state lives in
  `/data/auth`.
