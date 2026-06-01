import { query } from '../db';

// ---------------------------------------------------------------
// Dashboard overview (last N days)
// ---------------------------------------------------------------
export async function getOverviewStats(days = 30) {
  const rows = await query<{
    total_clicks: string;
    unique_clicks: string;
    conversions: string;
    revenue: string;
    spend: string;
    profit: string;
  }>(
    `SELECT
       COUNT(DISTINCT cl.id)                                              AS total_clicks,
       COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot) AS unique_clicks,
       COUNT(DISTINCT cv.id)                                              AS conversions,
       COALESCE(SUM(cv.payout), 0)                                        AS revenue,
       COALESCE((SELECT SUM(spend) FROM ad_spend
                  WHERE spend_date >= CURRENT_DATE - $1), 0)              AS spend,
       COALESCE(SUM(cv.payout), 0) -
         COALESCE((SELECT SUM(spend) FROM ad_spend
                    WHERE spend_date >= CURRENT_DATE - $1), 0)            AS profit
     FROM clicks cl
     LEFT JOIN conversions cv ON cv.click_id = cl.id
       AND cv.status = 'approved'
     WHERE cl.clicked_at >= NOW() - ($1 || ' days')::INTERVAL`,
    [days]
  );
  return rows[0];
}

// ---------------------------------------------------------------
// Daily timeseries (clicks, conversions, revenue, spend)
// ---------------------------------------------------------------
export async function getDailyTimeseries(days = 30, campaignId?: string) {
  const campaignFilter = campaignId ? 'AND cl.campaign_id = $2' : '';
  const params: unknown[] = [days];
  if (campaignId) params.push(campaignId);

  return query<{
    stat_date: string;
    unique_clicks: string;
    conversions: string;
    revenue: string;
    spend: string;
    profit: string;
    epc: string;
    cvr_pct: string;
  }>(
    `SELECT
       DATE(cl.clicked_at)                                                  AS stat_date,
       COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot)  AS unique_clicks,
       COUNT(DISTINCT cv.id)                                                 AS conversions,
       COALESCE(SUM(cv.payout), 0)                                           AS revenue,
       COALESCE(SUM(sp.spend), 0)                                            AS spend,
       COALESCE(SUM(cv.payout), 0) - COALESCE(SUM(sp.spend), 0)             AS profit,
       CASE
         WHEN COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot) = 0 THEN 0
         ELSE ROUND(COALESCE(SUM(cv.payout),0) /
              COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot), 2)
       END AS epc,
       CASE
         WHEN COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot) = 0 THEN 0
         ELSE ROUND(COUNT(DISTINCT cv.id)::NUMERIC /
              COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot) * 100, 2)
       END AS cvr_pct
     FROM clicks cl
     LEFT JOIN conversions cv ON cv.click_id = cl.id AND cv.status = 'approved'
     LEFT JOIN ad_spend sp    ON sp.campaign_id = cl.campaign_id
                              AND sp.spend_date = DATE(cl.clicked_at)
     WHERE cl.clicked_at >= NOW() - ($1 || ' days')::INTERVAL
       ${campaignFilter}
     GROUP BY DATE(cl.clicked_at)
     ORDER BY stat_date ASC`,
    params
  );
}

// ---------------------------------------------------------------
// Per-campaign summary
// ---------------------------------------------------------------
export async function getCampaignSummaries() {
  return query(
    `SELECT * FROM v_campaign_summary ORDER BY total_revenue DESC`
  );
}

// ---------------------------------------------------------------
// Top performers: by ad set
// ---------------------------------------------------------------
export async function getTopAdSets(days = 7, limit = 10) {
  return query<{
    ad_set_name: string;
    campaign_name: string;
    platform: string;
    unique_clicks: string;
    conversions: string;
    revenue: string;
    spend: string;
    roi_pct: string;
  }>(
    `SELECT
       ads.name                                                              AS ad_set_name,
       c.name                                                                AS campaign_name,
       ads.platform,
       COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot)  AS unique_clicks,
       COUNT(DISTINCT cv.id)                                                 AS conversions,
       COALESCE(SUM(cv.payout), 0)                                           AS revenue,
       COALESCE(SUM(sp.spend), 0)                                            AS spend,
       CASE WHEN COALESCE(SUM(sp.spend),0) = 0 THEN NULL
            ELSE ROUND((COALESCE(SUM(cv.payout),0) / SUM(sp.spend))*100, 1)
       END AS roi_pct
     FROM ad_sets ads
     JOIN campaigns c        ON c.id = ads.campaign_id
     LEFT JOIN clicks cl     ON cl.ad_set_id = ads.id
       AND cl.clicked_at >= NOW() - ($1 || ' days')::INTERVAL
     LEFT JOIN conversions cv ON cv.click_id = cl.id AND cv.status = 'approved'
     LEFT JOIN ad_spend sp   ON sp.ad_set_id = ads.id
       AND sp.spend_date >= CURRENT_DATE - $1
     GROUP BY ads.id, ads.name, c.name, ads.platform
     ORDER BY revenue DESC
     LIMIT $2`,
    [days, limit]
  );
}

// ---------------------------------------------------------------
// Geographic breakdown
// ---------------------------------------------------------------
export async function getGeoBreakdown(days = 30, campaignId?: string) {
  const campaignFilter = campaignId ? 'AND campaign_id = $2' : '';
  const params: unknown[] = [days];
  if (campaignId) params.push(campaignId);

  return query<{
    country: string;
    clicks: string;
    conversions: string;
    revenue: string;
  }>(
    `SELECT
       COALESCE(cl.country, 'Unknown')                                    AS country,
       COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot) AS clicks,
       COUNT(DISTINCT cv.id)                                               AS conversions,
       COALESCE(SUM(cv.payout), 0)                                         AS revenue
     FROM clicks cl
     LEFT JOIN conversions cv ON cv.click_id = cl.id AND cv.status = 'approved'
     WHERE cl.clicked_at >= NOW() - ($1 || ' days')::INTERVAL
       ${campaignFilter}
     GROUP BY cl.country
     ORDER BY revenue DESC
     LIMIT 20`,
    params
  );
}

// ---------------------------------------------------------------
// Device breakdown
// ---------------------------------------------------------------
export async function getDeviceBreakdown(days = 30) {
  return query<{ device: string; clicks: string; conversions: string; cvr_pct: string }>(
    `SELECT
       cl.device,
       COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot) AS clicks,
       COUNT(DISTINCT cv.id)                                                AS conversions,
       CASE WHEN COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot) = 0 THEN 0
            ELSE ROUND(COUNT(DISTINCT cv.id)::NUMERIC /
                 COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot)*100,2)
       END AS cvr_pct
     FROM clicks cl
     LEFT JOIN conversions cv ON cv.click_id = cl.id AND cv.status = 'approved'
     WHERE cl.clicked_at >= NOW() - ($1 || ' days')::INTERVAL
       AND NOT cl.is_bot
     GROUP BY cl.device
     ORDER BY clicks DESC`,
    [days]
  );
}

// ---------------------------------------------------------------
// Hourly heatmap (which hours convert best)
// ---------------------------------------------------------------
export async function getHourlyHeatmap(days = 14) {
  return query<{ hour: string; day_of_week: string; conversions: string }>(
    `SELECT
       EXTRACT(HOUR FROM converted_at)::int       AS hour,
       EXTRACT(DOW  FROM converted_at)::int       AS day_of_week,
       COUNT(*)                                    AS conversions
     FROM conversions
     WHERE status = 'approved'
       AND converted_at >= NOW() - ($1 || ' days')::INTERVAL
     GROUP BY hour, day_of_week
     ORDER BY day_of_week, hour`,
    [days]
  );
}
