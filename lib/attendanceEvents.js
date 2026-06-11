/**
 * Very small SSE hub for attendance-related invalidations.
 *
 * Clients subscribe with:
 *   GET /api/events/attendance?company=Thrive
 *
 * We emit only "something changed" notifications (no sensitive payload),
 * and the UI revalidates via ETag-enabled stats endpoints.
 */

const clients = new Set();

function nowIso() {
  return new Date().toISOString();
}

function safeTrim(v) {
  return String(v || '').trim();
}

function writeSse(res, { event, data }) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function subscribeAttendanceEvents(req, res) {
  const company = safeTrim(req.query.company || req.headers['x-company'] || '');

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // If behind nginx, this helps prevent buffering.
  res.setHeader('X-Accel-Buffering', 'no');

  // Initial hello
  writeSse(res, {
    event: 'ready',
    data: { ok: true, company: company || null, at: nowIso() },
  });

  const client = { res, company: company || null };
  clients.add(client);

  // Keepalive ping (some proxies close idle connections)
  const ping = setInterval(() => {
    try {
      writeSse(res, { event: 'ping', data: { at: nowIso() } });
    } catch {
      // ignore
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
}

function emitAttendanceChanged({ company, type = 'changed', date = null, meta = null } = {}) {
  const c = safeTrim(company);
  const payload = {
    type,
    company: c || null,
    date: date ? String(date) : null,
    at: nowIso(),
    meta: meta || null,
  };

  for (const client of clients) {
    if (client.company && c && client.company.toLowerCase() !== c.toLowerCase()) continue;
    try {
      writeSse(client.res, { event: 'attendance', data: payload });
    } catch {
      // Drop broken clients lazily (close handler will clean most cases)
    }
  }
}

module.exports = {
  subscribeAttendanceEvents,
  emitAttendanceChanged,
};

