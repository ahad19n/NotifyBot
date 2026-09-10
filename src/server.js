const express = require('express');

const { resp, apiKeyMiddleware, gracefulShutdown } = require('./func');
const { createClient, normalizePhoneNumber } = require('./whatsapp');

// -------------------------------------------------------------------------- //

const phoneNumber = normalizePhoneNumber(process.env.PHONE_NUMBER);

if (!phoneNumber) {
  console.error("[ERROR] PHONE_NUMBER must be the bot's own number in international format, digits only (e.g. 923001234567)");
  process.exit(1);
}

// Baileys addresses users as @s.whatsapp.net and groups as @g.us — the @c.us
// form used by whatsapp-web.js is not accepted
const JID_SUFFIXES = ['@s.whatsapp.net', '@g.us'];

let client = null;

createClient({ phoneNumber, pairingCode: process.env.PAIRING_CODE })
  .then((created) => { client = created; })
  .catch((err) => {
    console.error('[ERROR] Failed to start WhatsApp client:', err);
    process.exit(1);
  });

// -------------------------------------------------------------------------- //

const app = express();
app.use(express.json());

app.post('/send', apiKeyMiddleware, async (req, res) => {
  const chatId = req.body?.chatId ?? req.query?.chatId;
  const message = req.body?.message ?? req.query?.message;

  if (!chatId || !message) {
    return resp(res, 400, 'Missing or empty fields (chatId, message)');
  }

  if (!JID_SUFFIXES.some((suffix) => String(chatId).endsWith(suffix))) {
    return resp(res, 400, 'Invalid chatId (expected a WhatsApp JID ending in @s.whatsapp.net for a user or @g.us for a group)');
  }

  if (!client?.isReady()) {
    return resp(res, 503, 'WhatsApp client not connected');
  }

  try {
    await client.sendText(String(chatId), message);
    return resp(res, 200, 'Sent message successfully');
  }

  catch (err) {
    console.error('[ERROR] Failed to send message:', err);
    return resp(res, 500, 'Failed to send message');
  }
});

// -------------------------------------------------------------------------- //

const server = app.listen(process.env.PORT || 3000, () => {
  console.log('[INFO] Server listening on port', process.env.PORT || 3000);
});

process.on('SIGINT', () => gracefulShutdown(server, client));
process.on('SIGTERM', () => gracefulShutdown(server, client));
