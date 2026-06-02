import type { Request } from 'express';
import { UAParser } from 'ua-parser-js';
import geoip from 'geoip-lite';
import { query } from '../db.js';

export interface ClickRecord {
  id: string;
  campaign_id: string;
  ad_set_id?: string;
  ad_id?: string;
  sub1?: string;
  sub2?: string;
  sub3?: string;
  sub4?: string;
  sub5?: string;
  ip: string;
  user_agent: string;
  referrer: string;
  country?: string;
  region?: string;
  city?: string;
  device: string;
  os: string;
  browser: string;
  lp_variant: string;
  is_unique: boolean;
  is_bot: boolean;
  clicked_at: string;
}

const BOT_UA_PATTERNS = [
  /bot/i, /crawler/i, /spider/i, /scraper/i,
  /headless/i, /phantom/i, /selenium/i, /puppeteer/i,
  /googlebot/i, /bingbot/i, /facebookexternalhit/i,
  /curl/i, /wget/i, /python-requests/i,
];

function detectBot(ua: string): boolean {
  return BOT_UA_PATTERNS.some(p => p.test(ua));
}

function parseDevice(ua: string): 'desktop' | 'mobile' | 'tablet' | 'unknown' {
  const parser = new UAParser(ua);
  const device = parser.getDevice();
  if (device.type === 'mobile')  return 'mobile';
  if (device.type === 'tablet')  return 'tablet';
  if (!device.type)              return 'desktop';
  return 'unknown';
}

function getRealIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return (Array.isArray(forwarded) ? forwarded[0] : forwarded)
      .split(',')[0].trim();
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

async function isUniqueClick(ip: string, campaignId: string): Promise<boolean> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM clicks
     WHERE ip = $1::inet
       AND campaign_id = $2
       AND clicked_at > NOW() - INTERVAL '24 hours'`,
    [ip, campaignId]
  );
  return parseInt(rows[0]?.count ?? '0') === 0;
}

async function selectVariant(campaignId: string): Promise<string> {
  const variants = await query<{ variant: string; weight: number }>(
    `SELECT variant, weight FROM lp_variants
     WHERE campaign_id = $1 ORDER BY variant`,
    [campaignId]
  );
  if (!variants.length) return 'A';

  const total = variants.reduce((sum: number, v: { variant: string; weight: number }) => sum + v.weight, 0);
  let rand = Math.random() * total;
  for (const v of variants) {
    rand -= v.weight;
    if (rand <= 0) return v.variant;
  }
  return variants[0]?.variant ?? 'A';
}

export async function recordClick(
  req: Request,
  campaignSlug: string
): Promise<{ clickId: string; offerUrl: string; variant: string } | null> {

  const campaigns = await query<{
    id: string; offer_url: string; status: string;
  }>(
    `SELECT id, offer_url, status FROM campaigns WHERE slug = $1`,
    [campaignSlug]
  );
  if (!campaigns.length || campaigns[0]?.status !== 'active') return null;
  const campaign = campaigns[0];
  if (!campaign) return null;

  const ip        = getRealIp(req);
  const ua        = req.headers['user-agent'] || '';
  const isBot     = detectBot(ua);
  const isUnique  = isBot ? false : await isUniqueClick(ip, campaign.id);

  const parser  = new UAParser(ua);
  const geo     = geoip.lookup(ip);
  const variant = await selectVariant(campaign.id);

  const rows = await query<{ id: string }>(
    `INSERT INTO clicks (
       campaign_id, sub1, sub2, sub3, sub4, sub5,
       ip, user_agent, referrer, country, region, city,
       device, os, browser, lp_variant, is_unique, is_bot
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7::inet, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17, $18
     ) RETURNING id`,
    [
      campaign.id,
      req.query.sub1 || req.query.utm_campaign || null,
      req.query.sub2 || req.query.utm_content  || null,
      req.query.sub3 || req.query.utm_term     || null,
      req.query.sub4 || null,
      req.query.sub5 || null,
      ip,
      ua,
      req.headers.referer || '',
      geo?.country || null,
      geo?.region  || null,
      geo?.city    || null,
      parseDevice(ua),
      parser.getOS().name   || 'Unknown',
      parser.getBrowser().name || 'Unknown',
      variant,
      isUnique,
      isBot,
    ]
  );

  const clickId = rows[0]?.id;
  if (!clickId) return null;

  const url = new URL(campaign.offer_url);
  url.searchParams.set('click_id', clickId);
  if (req.query.sub1) url.searchParams.set('sub1', String(req.query.sub1));
  if (req.query.sub2) url.searchParams.set('sub2', String(req.query.sub2));

  return { clickId, offerUrl: url.toString(), variant };
}
