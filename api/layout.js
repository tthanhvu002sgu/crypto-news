/* global process */
import { Redis } from '@upstash/redis';

const LAYOUT_KEY = 'crypto-news:ui-layout:v1';

function getRedisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return null;
  }
  return new Redis({ url, token });
}

function sanitizeLayoutPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const hiddenModules = Array.isArray(raw.hiddenModules)
    ? Array.from(
        new Set(
          raw.hiddenModules
            .filter((id) => typeof id === 'string' && id.trim().length > 0)
            .slice(0, 200)
        )
      )
    : [];

  const moduleOrders = {};
  if (raw.moduleOrders && typeof raw.moduleOrders === 'object' && !Array.isArray(raw.moduleOrders)) {
    for (const [groupKey, list] of Object.entries(raw.moduleOrders)) {
      if (typeof groupKey === 'string' && Array.isArray(list)) {
        moduleOrders[groupKey] = list.filter((id) => typeof id === 'string' && id.trim().length > 0);
      }
    }
  }

  return {
    hiddenModules,
    moduleOrders,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const redis = getRedisClient();
  if (!redis) {
    return res.status(200).json({
      configured: false,
      layout: null,
    });
  }

  try {
    if (req.method === 'GET') {
      const saved = await redis.get(LAYOUT_KEY);
      const layout = saved ? sanitizeLayoutPayload(saved) : null;
      return res.status(200).json({
        configured: true,
        layout,
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const layout = sanitizeLayoutPayload({
        ...body,
        updatedAt: Date.now(),
      });

      if (!layout) {
        return res.status(400).json({ error: 'Invalid layout payload' });
      }

      await redis.set(LAYOUT_KEY, layout);
      return res.status(200).json({
        configured: true,
        ok: true,
        layout,
      });
    }

    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[api/layout] Redis error:', err);
    return res.status(500).json({ error: 'Failed to access layout storage' });
  }
}
