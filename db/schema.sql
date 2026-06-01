-- ============================================================
-- Affiliate Tracking System - Database Schema
-- Compatible with PostgreSQL 14+
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- CAMPAIGNS
-- ============================================================
CREATE TABLE campaigns (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(100) UNIQUE NOT NULL,        -- used in tracking URLs
  offer_url     TEXT NOT NULL,                        -- destination affiliate URL
  offer_name    VARCHAR(255),                         -- e.g. "Hims GLP-1", "Roman ED"
  network       VARCHAR(100),                         -- e.g. "ClickBank", "ShareASale"
  payout        NUMERIC(10,2) DEFAULT 0,              -- commission per conversion ($)
  daily_budget  NUMERIC(10,2),
  status        VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AD SETS  (Facebook ad set or Google ad group)
-- ============================================================
CREATE TABLE ad_sets (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  platform      VARCHAR(50) DEFAULT 'facebook' CHECK (platform IN ('facebook','google','tiktok','native','email','organic')),
  external_id   VARCHAR(255),                         -- Facebook ad set ID
  daily_budget  NUMERIC(10,2),
  status        VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ADS  (individual creative)
-- ============================================================
CREATE TABLE ads (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ad_set_id     UUID NOT NULL REFERENCES ad_sets(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  external_id   VARCHAR(255),                         -- Facebook ad ID
  headline      TEXT,
  body_copy     TEXT,
  creative_url  TEXT,
  status        VARCHAR(20) DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CLICKS  (one row per tracked click)
-- ============================================================
CREATE TABLE clicks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id),
  ad_set_id     UUID REFERENCES ad_sets(id),
  ad_id         UUID REFERENCES ads(id),

  -- UTM / sub-ID params
  sub1          VARCHAR(255),   -- typically fb campaign id
  sub2          VARCHAR(255),   -- typically fb ad set id
  sub3          VARCHAR(255),   -- typically fb ad id
  sub4          VARCHAR(255),   -- custom label
  sub5          VARCHAR(255),   -- custom label

  -- Visitor fingerprint
  ip            INET,
  user_agent    TEXT,
  referrer      TEXT,
  country       CHAR(2),
  region        VARCHAR(100),
  city          VARCHAR(100),
  device        VARCHAR(20) CHECK (device IN ('desktop','mobile','tablet','unknown')),
  os            VARCHAR(50),
  browser       VARCHAR(50),

  -- Landing page variant (A/B test)
  lp_variant    VARCHAR(10) DEFAULT 'A',

  clicked_at    TIMESTAMPTZ DEFAULT NOW(),

  -- Duplicate/bot detection
  is_unique     BOOLEAN DEFAULT TRUE,
  is_bot        BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_clicks_campaign ON clicks(campaign_id);
CREATE INDEX idx_clicks_clicked_at ON clicks(clicked_at);
CREATE INDEX idx_clicks_ip ON clicks(ip);

-- ============================================================
-- CONVERSIONS  (postback from affiliate network)
-- ============================================================
CREATE TABLE conversions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  click_id        UUID REFERENCES clicks(id),          -- null if unmatched
  campaign_id     UUID NOT NULL REFERENCES campaigns(id),

  -- Network postback data
  network_txn_id  VARCHAR(255) UNIQUE,                 -- network's transaction ID
  payout          NUMERIC(10,2) NOT NULL,
  status          VARCHAR(30) DEFAULT 'approved' CHECK (status IN ('approved','pending','reversed','rejected')),

  -- Pass-through params from click
  sub1            VARCHAR(255),
  sub2            VARCHAR(255),
  sub3            VARCHAR(255),

  converted_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversions_campaign ON conversions(campaign_id);
CREATE INDEX idx_conversions_converted_at ON conversions(converted_at);
CREATE INDEX idx_conversions_click ON conversions(click_id);

-- ============================================================
-- EMAIL LEADS  (captured before redirect)
-- ============================================================
CREATE TABLE leads (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) NOT NULL,
  first_name    VARCHAR(100),
  campaign_id   UUID REFERENCES campaigns(id),
  click_id      UUID REFERENCES clicks(id),
  ip            INET,
  subscribed    BOOLEAN DEFAULT TRUE,
  tags          TEXT[],                                 -- e.g. {'glp1','weight-loss'}
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_leads_email_campaign ON leads(email, campaign_id);
CREATE INDEX idx_leads_created ON leads(created_at);

-- ============================================================
-- AD SPEND  (imported from Facebook/Google API daily)
-- ============================================================
CREATE TABLE ad_spend (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id   UUID REFERENCES campaigns(id),
  ad_set_id     UUID REFERENCES ad_sets(id),
  ad_id         UUID REFERENCES ads(id),
  platform      VARCHAR(50),
  spend_date    DATE NOT NULL,
  spend         NUMERIC(10,2) NOT NULL DEFAULT 0,
  impressions   INTEGER DEFAULT 0,
  link_clicks   INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ad_set_id, spend_date)
);

CREATE INDEX idx_spend_date ON ad_spend(spend_date);
CREATE INDEX idx_spend_campaign ON ad_spend(campaign_id);

-- ============================================================
-- LANDING PAGE VARIANTS  (A/B test config)
-- ============================================================
CREATE TABLE lp_variants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id),
  variant       VARCHAR(10) NOT NULL,                  -- 'A', 'B', 'C'
  name          VARCHAR(255),
  weight        INTEGER DEFAULT 50,                    -- traffic split %
  is_control    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- VIEWS: handy aggregations
-- ============================================================

-- Daily campaign stats
CREATE VIEW v_daily_campaign_stats AS
SELECT
  c.id           AS campaign_id,
  c.name         AS campaign_name,
  DATE(cl.clicked_at) AS stat_date,
  COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot)  AS unique_clicks,
  COUNT(DISTINCT cl.id)                                                  AS total_clicks,
  COUNT(DISTINCT cv.id)                                                  AS conversions,
  COALESCE(SUM(cv.payout), 0)                                            AS revenue,
  COALESCE(SUM(sp.spend), 0)                                             AS spend,
  COALESCE(SUM(cv.payout), 0) - COALESCE(SUM(sp.spend), 0)              AS profit,
  CASE WHEN COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot) = 0
       THEN 0
       ELSE ROUND(
         COUNT(DISTINCT cv.id)::NUMERIC /
         COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot) * 100, 2
       )
  END AS cvr_pct,
  CASE WHEN COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot) = 0
       THEN 0
       ELSE ROUND(
         COALESCE(SUM(cv.payout), 0) /
         COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot), 2
       )
  END AS epc                                                             -- earnings per click
FROM campaigns c
LEFT JOIN clicks cl     ON cl.campaign_id = c.id
LEFT JOIN conversions cv ON cv.campaign_id = c.id
  AND DATE(cv.converted_at) = DATE(cl.clicked_at)
LEFT JOIN ad_spend sp   ON sp.campaign_id = c.id
  AND sp.spend_date = DATE(cl.clicked_at)
GROUP BY c.id, c.name, DATE(cl.clicked_at);

-- All-time campaign summary
CREATE VIEW v_campaign_summary AS
SELECT
  c.id, c.name, c.status, c.offer_name, c.network, c.payout,
  COUNT(DISTINCT cl.id) FILTER (WHERE cl.is_unique AND NOT cl.is_bot) AS total_unique_clicks,
  COUNT(DISTINCT cv.id)                                                 AS total_conversions,
  COALESCE(SUM(cv.payout), 0)                                           AS total_revenue,
  COALESCE(SUM(sp.spend), 0)                                            AS total_spend,
  COALESCE(SUM(cv.payout), 0) - COALESCE(SUM(sp.spend), 0)             AS total_profit,
  CASE WHEN COALESCE(SUM(sp.spend), 0) = 0 THEN NULL
       ELSE ROUND((COALESCE(SUM(cv.payout),0) / SUM(sp.spend)) * 100, 1)
  END AS roi_pct
FROM campaigns c
LEFT JOIN clicks cl      ON cl.campaign_id = c.id
LEFT JOIN conversions cv ON cv.campaign_id = c.id
LEFT JOIN ad_spend sp    ON sp.campaign_id = c.id
GROUP BY c.id, c.name, c.status, c.offer_name, c.network, c.payout;
