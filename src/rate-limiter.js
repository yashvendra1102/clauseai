export function createRateLimiter(windowMs, max, maxEntries = 10000) {
  const hits = new Map();

  function prune(now) {
    for (const [ip, entry] of hits) {
      if (now >= entry.reset) hits.delete(ip);
    }
  }

  const intervalMs = Math.min(Math.max(windowMs, 1000), 60000);
  const timer = setInterval(() => {
    prune(Date.now());
  }, intervalMs);
  if (timer.unref) {
    timer.unref();
  }

  return function check(ip) {
    const now = Date.now();
    let entry = hits.get(ip);

    if (!entry || now >= entry.reset) {
      if (hits.size >= maxEntries) {
        prune(now);
        if (hits.size >= maxEntries) {
          let count = Math.ceil(maxEntries * 0.1);
          for (const key of hits.keys()) {
            hits.delete(key);
            if (--count <= 0) break;
          }
        }
      }

      entry = { count: 0, reset: now + windowMs };
      hits.set(ip, entry);
    }

    entry.count += 1;
    return {
      allowed: entry.count <= max,
      remaining: Math.max(0, max - entry.count),
      reset: entry.reset,
      limit: max,
    };
  };
}
