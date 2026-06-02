import { Router } from 'express';
import type { Request, Response } from 'express';
import { recordClick } from './services/clickTracker.js';
import { processPostback, reverseConversion } from './services/conversionTracker.js';
import {
  getOverviewStats,
  getDailyTimeseries,
  getCampaignSummaries,
  getTopAdSets,
  getGeoBreakdown,
  getDeviceBreakdown,
  getHourlyHeatmap,
} from './services/analytics.js';
import { query } from './db.js';

const router = Router();

router.get('/track/:slug', async (req: Request, res: Response) => {
  try {
    const result = await recordClick(req, req.params.slug);
    if (!result) return res.status(404).send('Campaign not found or inactive');
    return res.redirect(302, result.offerUrl);
  } catch (err) {
    console.error('Click tracking error:', err);
    return res.status(500).send('Tracking error');
  }
});

router.get('/postback', async (req: Request, res: Response) => {
  try {
    const result = await processPostback({
      click_id:       req.query.click_id    as string,
      network_txn_id: (req.query.txn as string) || req.query.transaction_id as string,
      campaign_slug:  req.query.campaign    as string,
      payout:         (req.query.payout as string) || req.query.amount as string,
      status:         req.query.status      as string,
      sub1:           req.query.sub1        as string,
      sub2:           req.query.sub2        as string,
      sub3:           req.query.sub3        as string,
    });
    return res.json(result);
  } catch (err) {
    console.error('Postback error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/postback/reverse', async (req: Request, res: Response) => {
  const { network_txn_id } = req.body as { network_txn_id: string };
  if (!network_txn_id) return res.status(400).json({ error: 'network_txn_id required' });
  const ok = await reverseConversion(network_txn_id);
  return res.json({ success: ok });
});

router.post('/leads', async (req: Request, res: Response) => {
  const { email, first_name, campaign_id, click_id } = req.body as {
    email: string; first_name?: string; campaign_id?: string; click_id?: string;
  };
  if (!email) return res.status(400).json({ error: 'email required' });
  try {
    await query(
      `INSERT INTO leads (email, first_name, campaign_id, click_id, ip)
       VALUES ($1, $2, $3, $4, $5::inet)
       ON CONFLICT (email, campaign_id) DO NOTHING`,
      [email, first_name || null, campaign_id || null, click_id || null,
       req.socket.remoteAddress || '0.0.0.0']
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false });
  }
});

router.get('/api/stats/overview', async (req: Request, res: Response) => {
  const days = parseInt(req.query.days as string) || 30;
  const data = await getOverviewStats(days);
  return res.json(data);
});

router.get('/api/stats/timeseries', async (req: Request, res: Response) => {
  const days = parseInt(req.query.days as string) || 30;
  const campaignId = req.query.campaign_id as string | undefined;
  const data = await getDailyTimeseries(days, campaignId);
  return res.json(data);
});

router.get('/api/stats/campaigns', async (_req: Request, res: Response) => {
  const data = await getCampaignSummaries();
  return res.json(data);
});

router.get('/api/stats/adsets', async (req: Request, res: Response) => {
  const days  = parseInt(req.query.days  as string) || 7;
  const limit = parseInt(req.query.limit as string) || 10;
  const data  = await getTopAdSets(days, limit);
  return res.json(data);
});

router.get('/api/stats/geo', async (req: Request, res: Response) => {
  const days       = parseInt(req.query.days as string) || 30;
  const campaignId = req.query.campaign_id as string | undefined;
  const data       = await getGeoBreakdown(days, campaignId);
  return res.json(data);
});

router.get('/api/stats/devices', async (req: Request, res: Response) => {
  const days = parseInt(req.query.days as string) || 30;
  const data = await getDeviceBreakdown(days);
  return res.json(data);
});

router.get('/api/stats/heatmap', async (req: Request, res: Response) => {
  const days = parseInt(req.query.days as string) || 14;
  const data = await getHourlyHeatmap(days);
  return res.json(data);
});

router.get('/api/campaigns', async (_req: Request, res: Response) => {
  const rows = await query('SELECT * FROM campaigns ORDER BY created_at DESC');
  return res.json(rows);
});

router.post('/api/campaigns', async (req: Request, res: Response) => {
  const { name, slug, offer_url, offer_name, network, payout, daily_budget } = req.body as {
    name: string; slug: string; offer_url: string; offer_name?: string;
    network?: string; payout?: number; daily_budget?: number;
  };
  const rows = await query<{ id: string }>(
    `INSERT INTO campaigns (name, slug, offer_url, offer_name, network, payout, daily_budget)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [name, slug, offer_url, offer_name, network, payout || 0, daily_budget || null]
  );
  return res.json({ id: rows[0]?.id });
});

router.patch('/api/campaigns/:id', async (req: Request, res: Response) => {
  const { status } = req.body as { status: string };
  await query(
    `UPDATE campaigns SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, req.params.id]
  );
  return res.json({ success: true });
});

router.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok', ts: new Date() }));

export default router;
