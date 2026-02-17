const express = require('express');
const qrcode = require('qrcode-terminal');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const { resp, gracefulShutdown } = require('./func');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

// -------------------------------------------------------------------------- //
// WhatsApp Client
// -------------------------------------------------------------------------- //

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '/data' }),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('[INFO] WhatsApp client ready');
});

client.on('disconnected', () => {
  console.log('[INFO] WhatsApp client disconnected');
});

client.initialize();

// -------------------------------------------------------------------------- //
// Express App
// -------------------------------------------------------------------------- //

const app = express();
app.use(express.json());

// -------------------------------------------------------------------------- //
// Multer (disk storage – safe for large images)
// -------------------------------------------------------------------------- //

const uploadDir = '/tmp/uploads';
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_, file, cb) => {
      cb(null, Date.now() + '-' + file.originalname);
    }
  }),
  limits: {
    fileSize: 20 * 1024 * 1024 // 20 MB per image
  }
});

// -------------------------------------------------------------------------- //
// Existing text-only endpoint (unchanged)
// -------------------------------------------------------------------------- //

app.post('/send', async (req, res) => {
  const { number, message } = req.body || {};

  if (!number || !message) {
    return resp(res, 400, 'Missing or empty fields (number, message)');
  }

  try {
    const chatId = `${number}@c.us`;
    await client.sendMessage(chatId, message);
    return resp(res, 200, 'Sent message successfully');
  } catch (err) {
    console.error('[ERROR] Failed to send message:', err);
    return resp(res, 500, 'Failed to send message');
  }
});

// -------------------------------------------------------------------------- //
// 🔥 NEW: Receive images from ESP8266 and forward to WhatsApp
// -------------------------------------------------------------------------- //

app.post('/send-images', upload.array('file[]'), async (req, res) => {
  const { number, caption } = req.body;
  const files = req.files;

  if (!number) {
    return resp(res, 400, 'Missing field: number');
  }

  if (!files || files.length === 0) {
    return resp(res, 400, 'No images uploaded');
  }

  const chatId = `${number}@c.us`;

  try {
    for (const file of files) {
      const media = MessageMedia.fromFilePath(file.path);
      await client.sendMessage(chatId, media, {
        caption: caption || undefined
      });

      // cleanup file after sending
      fs.unlink(file.path, () => {});
    }

    return resp(res, 200, `Sent ${files.length} image(s) successfully`);
  } catch (err) {
    console.error('[ERROR] Failed to send images:', err);
    return resp(res, 500, 'Failed to send images');
  }
});

// -------------------------------------------------------------------------- //
// Server lifecycle
// -------------------------------------------------------------------------- //

const server = app.listen(process.env.PORT || 3000, () => {
  console.log('[INFO] Server listening on port', process.env.PORT || 3000);
});

process.on('SIGINT', () => gracefulShutdown(server));
process.on('SIGTERM', () => gracefulShutdown(server));
