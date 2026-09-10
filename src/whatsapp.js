const fs = require('node:fs/promises');

const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  delay
} = require('baileys');

// -------------------------------------------------------------------------- //

const AUTH_DIR = process.env.AUTH_DIR || '/data/auth';

const PAIR_DELAY_MS = 3000;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30000;

// Baileys is extremely chatty at the protocol level — silence it and keep our
// own [INFO]/[ERROR] lines as the only output
const logger = pino({ level: 'silent' });

// Disconnect reasons meaning the stored credentials will never work again; the
// only way back is wiping them and pairing from scratch
const UNRECOVERABLE = new Set([DisconnectReason.loggedOut, DisconnectReason.forbidden]);

exports.normalizePhoneNumber = (raw) => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
};

const printPairingCode = (code) => {
  const rule = '='.repeat(60);
  console.log([
    '',
    rule,
    `  PAIRING CODE: ${code}`,
    '',
    '  This device is not linked. On your phone, open WhatsApp and go to',
    '  Settings > Linked Devices > Link a Device > "Link with phone number',
    `  instead", then enter the code above.`,
    rule,
    ''
  ].join('\n'));
};

// -------------------------------------------------------------------------- //

exports.createClient = async ({ phoneNumber, pairingCode }) => {
  let sock = null;
  let ready = false;
  let stopped = false;
  let backoff = BACKOFF_MIN_MS;
  let reconnectTimer = null;

  const wipeAuth = async () => {
    await fs.rm(AUTH_DIR, { recursive: true, force: true });
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;

    const wait = backoff;
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);

    console.log(`[INFO] Reconnecting in ${Math.round(wait / 1000)}s`);

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      try {
        await connect();
      } catch (err) {
        console.error('[ERROR] Reconnect failed:', err);
        scheduleReconnect();
      }
    }, wait);
  };

  const handleClose = async (closed, lastDisconnect) => {
    ready = false;

    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const reason = DisconnectReason[statusCode] ?? 'unknown';

    // Another session evicted this one. Reconnecting would evict it straight
    // back and ping-pong forever, so stop and let a human sort it out
    if (statusCode === DisconnectReason.connectionReplaced) {
      console.error('[ERROR] Connection replaced by another session — is a second instance running? Not reconnecting.');
      stopped = true;
      return;
    }

    if (UNRECOVERABLE.has(statusCode)) {
      console.error(`[ERROR] Session is no longer valid (${reason}) — wiping credentials and re-pairing`);

      // Detach first so the dying socket cannot write creds back out after the
      // wipe and leave a half-valid auth dir behind
      closed.ev.removeAllListeners('creds.update');

      try {
        await wipeAuth();
      } catch (err) {
        console.error('[ERROR] Failed to wipe credentials:', err);
      }

      backoff = BACKOFF_MIN_MS;
      scheduleReconnect();
      return;
    }

    console.log(`[INFO] Disconnected (${reason})`);
    scheduleReconnect();
  };

  const connect = async () => {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const current = makeWASocket({
      auth: state,
      logger,
      browser: Browsers.ubuntu('Chrome'),
      // Reporting as online makes WhatsApp withhold push notifications from the
      // primary phone — for a gateway that runs 24/7 that would silently stop
      // the phone from ever buzzing again
      markOnlineOnConnect: false,
      // Nothing inbound is consumed, so skip the history sync entirely
      syncFullHistory: false
    });

    sock = current;

    current.ev.on('creds.update', saveCreds);

    current.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      // Ignore stragglers from a socket we have already replaced
      if (sock !== current) return;

      if (connection === 'open') {
        ready = true;
        backoff = BACKOFF_MIN_MS;
        console.log('[INFO] Connected as', current.user?.id);
        return;
      }

      if (connection === 'close') {
        handleClose(current, lastDisconnect);
      }
    });

    if (!current.authState.creds.registered) {
      // The socket has to reach 'connecting' before a code can be requested
      await delay(PAIR_DELAY_MS);

      try {
        const code = await current.requestPairingCode(phoneNumber, pairingCode);
        printPairingCode(code);
      } catch (err) {
        console.error('[ERROR] Failed to request pairing code:', err);
      }
    }
  };

  await connect();

  return {
    isReady: () => ready,

    sendText: (chatId, message) => sock.sendMessage(chatId, { text: message }),

    close: async () => {
      stopped = true;
      ready = false;

      clearTimeout(reconnectTimer);
      reconnectTimer = null;

      // end() closes the socket but leaves the credentials intact — logout()
      // would deregister the device and force a re-pair on every restart
      if (sock) await sock.end(undefined);
    }
  };
};
