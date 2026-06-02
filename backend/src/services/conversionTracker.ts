import { query } from '../db.js';

export interface PostbackParams {
  click_id?: string;
  network_txn_id: string;
  campaign_slug?: string;
  payout?: string;
  status?: string;
  sub1?: string;
  sub2?: string;
  sub3?: string;
}

export async function processPostback(params: PostbackParams): Promise<{
  success: boolean;
  message: string;
  conversion_id?: string;
}> {
  const { click_id, network_txn_id, payout, status = 'approved', sub1, sub2, sub3 } = params;

  const existing = await query<{ id: string }>(
    `SELECT id FROM conversions WHERE network_txn_id = $1`,
    [network_txn_id]
  );
  if (existing.length) {
    return { success: true, message: 'Already recorded', conversion_id: existing[0]?.id };
  }

  let campaign_id: string | null = null;

  if (click_id) {
    const clicks = await query<{ campaign_id: string }>(
      `SELECT campaign_id FROM clicks WHERE id = $1`,
      [click_id]
    );
    if (clicks.length) campaign_id = clicks[0]?.campaign_id ?? null;
  }

  if (!campaign_id && params.campaign_slug) {
    const campaigns = await query<{ id: string }>(
      `SELECT id FROM campaigns WHERE slug = $1`,
      [params.campaign_slug]
    );
    if (campaigns.length) campaign_id = campaigns[0]?.id ?? null;
  }

  if (!campaign_id) {
    return { success: false, message: 'Could not resolve campaign' };
  }

  const rows = await query<{ id: string }>(
    `INSERT INTO conversions (click_id, campaign_id, network_txn_id, payout, status, sub1, sub2, sub3)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      click_id || null,
      campaign_id,
      network_txn_id,
      parseFloat(payout || '0'),
      status,
      sub1 || null,
      sub2 || null,
      sub3 || null,
    ]
  );

  return { success: true, message: 'Conversion recorded', conversion_id: rows[0]?.id };
}

export async function reverseConversion(networkTxnId: string): Promise<boolean> {
  const result = await query(
    `UPDATE conversions SET status = 'reversed', updated_at = NOW()
     WHERE network_txn_id = $1`,
    [networkTxnId]
  ) as unknown as { rowCount: number };
  return (result as unknown as { rowCount: number }).rowCount > 0;
}
