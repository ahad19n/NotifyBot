const SHUTDOWN_TIMEOUT_MS = 10000;

let shuttingDown = false;

exports.resp = (res, code, message, data = {}) => {
  return res.status(code).json({
    success: (code >= 200 && code <= 299),
    message,
    data
  })
};

exports.apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.body?.apiKey ?? req.query?.apiKey;

  if (!apiKey) {
    return exports.resp(res, 400, 'Missing apiKey');
  }

  if (apiKey !== process.env.API_KEY) {
    return exports.resp(res, 401, 'Invalid apiKey');
  }

  next();
}

exports.gracefulShutdown = (server, client) => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('[INFO] Shutting down gracefully...');

  // A wedged socket must not hold the container past Docker's stop grace period
  const forceExit = setTimeout(() => {
    console.error('[ERROR] Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  forceExit.unref();

  server.close(async () => {
    console.log('[INFO] HTTP server closed');

    try {
      await client?.close();
      console.log('[INFO] WhatsApp client closed');
    } catch (err) {
      console.error('[ERROR] Error during WhatsApp client shutdown:', err);
    }

    clearTimeout(forceExit);
    process.exit(0);
  });
};
