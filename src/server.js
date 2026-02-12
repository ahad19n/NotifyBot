const express = require('express');
const qrcode = require('qrcode-terminal');

const { resp, gracefulShutdown } = require('./func');
const { Client, LocalAuth } = require('whatsapp-web.js');

// -------------------------------------------------------------------------- //

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '/data' }),
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('[INFO] event: ready');
});

client.on('disconnected', () => {
  console.log('[INFO] event: disconnected');
});

client.initialize();

// -------------------------------------------------------------------------- //

const app = express();
app.use(express.json());

app.post('/send', async (req, res) => {
  const { number, message } = req.body || {};

  if (!number || !message) {
    return resp(res, 400, 'Missing or empty fields (number, message)');
  }

  try {
    const chatId = `${number}@c.us`;
    await client.sendMessage(chatId, message);
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

process.on('SIGINT', () => gracefulShutdown(server));
process.on('SIGTERM', () => gracefulShutdown(server));
