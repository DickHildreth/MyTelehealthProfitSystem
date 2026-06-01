# AffiliateOS — Telehealth Affiliate Tracking System

A full-stack affiliate marketing infrastructure for running telehealth offers.
Built with TypeScript, Node.js/Express, PostgreSQL, and React.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Traffic Sources                          │
│          Facebook Ads · Google · Native · Email                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Pre-Sell Landing Page                         │
│              /landing-page/index.html                           │
│   • Warms up visitor with editorial-style content               │
│   • Captures email lead before redirect                         │
│   • A/B variant support                                         │
└────────────────────────┬────────────────────────────────────────┘
                         │ /track/:slug?sub1=...
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Tracking Server (Node/Express)                │
│                    /backend/src/index.ts                        │
│                                                                 │
│  /track/:slug    → Records click, redirects to offer            │
│  /postback       → Receives S2S conversion postback             │
│  /leads          → Stores email captures                        │
│  /api/stats/*    → Analytics endpoints                          │
└──────────┬──────────────────────────┬──────────────────────────┘
           │                          │
           ▼                          ▼
┌──────────────────┐       ┌──────────────────────────┐
│   PostgreSQL DB  │       │   Affiliate Network      │
│   /db/schema.sql │       │  (fires postback on cvr) │
│                  │       └──────────────────────────┘
│  • clicks        │
│  • conversions   │
│  • leads         │
│  • campaigns     │
│  • ad_spend      │
└──────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Analytics Dashboard                            │
│               /dashboard/index.html                             │
│   • KPI overview cards                                          │
│   • Revenue vs Spend chart                                      │
│   • Campaign performance table                                  │
│   • Top ad sets ranked by ROI                                   │
│   • Conversion log                                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Database Setup

```bash
# Create the database
createdb affiliate_tracking

# Run the schema
psql affiliate_tracking < db/schema.sql

# Seed a test campaign
psql affiliate_tracking << 'EOF'
INSERT INTO campaigns (name, slug, offer_url, offer_name, network, payout)
VALUES (
  'GLP-1 Weight Loss — FB Cold',
  'glp1-cold',
  'https://your-affiliate-link.com/?sub1=REPLACE',
  'Hims GLP-1',
  'Private',
  250.00
);
EOF
```

### 2. Backend Server

```bash
cd backend
cp ../.env.example .env
# Edit .env with your DB credentials

npm install
npm run build
npm start
# Server starts on http://localhost:3001
```

### 3. Landing Page

Host `/landing-page/index.html` on any static host (Netlify, Vercel, Cloudflare Pages).

Set your affiliate offer URL:
```html
<!-- Add to the bottom of index.html before </body> -->
<script>
  window.AFFILIATE_OFFER_URL = 'https://yourtrack.com/track/glp1-cold';
</script>
```

### 4. Analytics Dashboard

Open `/dashboard/index.html` in a browser, or host it statically.

In production, update the API base URL at the top of the dashboard script:
```javascript
const API_BASE = 'https://yourserver.com';
```

---

## How Tracking Works

### Click Flow

```
Ad URL: https://yourserver.com/track/glp1-cold?sub1={campaign.id}&sub2={adset.id}&sub3={ad.id}
         ↓
Server records click (IP, UA, geo, device, subs) → returns click_id
         ↓
Redirects to: https://affiliate-offer.com/?sub1=CAMPAIGN_ID&click_id=UUID
```

### Conversion Postback

In your affiliate network, set postback URL to:
```
https://yourserver.com/postback?click_id={CLICK_ID}&txn={TRANSACTION_ID}&payout={PAYOUT}
```

The `{CLICK_ID}` macro must match what you passed as a sub-ID parameter.

### Facebook UTM Setup

In your Facebook ad URL, use:
```
https://yourserver.com/track/glp1-cold?sub1={{campaign.id}}&sub2={{adset.id}}&sub3={{ad.id}}
```

Facebook will auto-replace the `{{...}}` dynamic parameters.

---

## Key API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/track/:slug` | Click redirect (main tracking URL) |
| GET | `/postback` | S2S conversion postback receiver |
| POST | `/leads` | Email lead capture |
| GET | `/api/stats/overview` | Dashboard KPI totals |
| GET | `/api/stats/timeseries?days=30` | Daily stats timeseries |
| GET | `/api/stats/campaigns` | Per-campaign summary |
| GET | `/api/stats/adsets?days=7` | Top ad sets by revenue |
| GET | `/api/stats/geo` | Geographic breakdown |
| GET | `/api/stats/devices` | Device breakdown |
| POST | `/api/campaigns` | Create new campaign |
| PATCH | `/api/campaigns/:id` | Update campaign status |

---

## A/B Testing Landing Pages

```sql
-- Set up A/B split for a campaign
INSERT INTO lp_variants (campaign_id, variant, name, weight, is_control)
VALUES
  ('your-campaign-uuid', 'A', 'Control — Doctor angle', 50, true),
  ('your-campaign-uuid', 'B', 'Variant — Before/after angle', 50, false);
```

The tracker automatically assigns variants weighted by traffic split.
Query `v_daily_campaign_stats` filtering by `lp_variant` to compare CVRs.

---

## Deploying to Production

### Recommended Stack
- **Server**: AWS EC2 t3.small or DigitalOcean Droplet ($12/mo)
- **Database**: AWS RDS PostgreSQL or Supabase (free tier to start)
- **Landing Page**: Cloudflare Pages (free)
- **Domain**: Route all through Cloudflare for DDoS protection

### Nginx Config (reverse proxy)
```nginx
server {
    listen 443 ssl;
    server_name yourserver.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Host $host;
    }
}
```

### Process Manager
```bash
npm install -g pm2
pm2 start dist/index.js --name affiliate-tracker
pm2 save
pm2 startup
```

---

## Files Overview

```
affiliate-system/
├── db/
│   └── schema.sql              # PostgreSQL schema + views
├── backend/
│   ├── src/
│   │   ├── index.ts            # Express server entry point
│   │   ├── routes.ts           # All API routes
│   │   ├── db.ts               # DB connection pool
│   │   └── services/
│   │       ├── clickTracker.ts # Click recording + bot detection
│   │       ├── conversionTracker.ts  # Postback processing
│   │       └── analytics.ts    # Aggregation queries
│   ├── package.json
│   └── tsconfig.json
├── landing-page/
│   └── index.html              # Pre-sell landing page
├── dashboard/
│   └── index.html              # React analytics dashboard
├── .env.example                # Environment variable template
└── README.md
```

---

## Important Legal Notes

- Include a **clear affiliate disclosure** on your landing page (FTC requirement)
- Ensure your claims are **substantiated** — don't promise specific weight loss results
- Review the **network terms** for each offer you promote
- GLP-1 / telehealth offers generally prohibit certain claim types — read guidelines carefully
- Keep an up-to-date **privacy policy** and **terms of service**

---

## Next Steps

1. **Ad Spend Import**: Connect the Facebook Marketing API to auto-import spend into `ad_spend` table
2. **Email Sequences**: Integrate SendGrid/Klaviyo for automated follow-up to captured leads
3. **Alerts**: Add webhook/email alerts when profit drops below threshold
4. **Bid Rules**: Add automated scaling rules based on EPC thresholds
