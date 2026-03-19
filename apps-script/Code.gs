/**
 * Core Plan Full Funnel Dashboard — Google Apps Script API
 *
 * Setup:
 * 1. Open the Lead Measure sheet → Extensions → Apps Script
 * 2. Paste this code
 * 3. Deploy → New deployment → Web app → Anyone can access
 * 4. Copy the URL → paste into dashboard HTML
 */

const LEAD_SHEET_ID = "1y2MlUqSHYMSefkVFoxo6Kh5YYTFWvk00R__nUWH7Afw";
const MKT_SHEET_ID = "145fp9fBz8qszcjSd45azGk0gU_s8coPfzf8i-Do_l8M";

function doGet(e) {
  const data = buildData();
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function buildData() {
  const leadSS = SpreadsheetApp.openById(LEAD_SHEET_ID);
  const mktSS = SpreadsheetApp.openById(MKT_SHEET_ID);

  // 1. Overview tab — Health Status + Weekly Trend + Countries
  const ov = leadSS.getSheetByName("Overview").getRange("A1:Q30").getValues();

  const health = {};
  const weekly = [];
  const countries = [];

  for (let i = 1; i < ov.length; i++) {
    const row = ov[i];

    // Countries (cols A-D)
    if (row[0] && row[1]) {
      try {
        countries.push({
          country: row[0],
          orgs: parseInt(String(row[1]).replace(/,/g, "")) || 0,
          active: parseInt(String(row[2]).replace(/,/g, "")) || 0,
          active_pct: row[3] || "0%"
        });
      } catch(e) {}
    }

    // Health Status (cols E-H)
    if (row[4] && row[5]) {
      try {
        health[row[4]] = {
          total: parseInt(String(row[5]).replace(/,/g, "")) || 0,
          self_serve: parseInt(String(row[6]).replace(/,/g, "")) || 0,
          contract: parseInt(String(row[7]).replace(/,/g, "")) || 0,
        };
      } catch(e) {}
    }

    // Weekly Trend (cols J-Q)
    const weekStr = row[9];
    if (weekStr && !["week_start","Total","총계"].includes(weekStr)) {
      try {
        const w = {
          week: weekStr instanceof Date ? Utilities.formatDate(weekStr, "Asia/Seoul", "yyyy-MM-dd") : String(weekStr),
          total: parseInt(String(row[10]).replace(/,/g, "")) || 0,
        };
        const stages = ["onboarding","churn_risk_onboarding","active","churn_risk_activation","paid","churned"];
        stages.forEach((s, j) => {
          const val = row[11 + j];
          w[s] = (val && val !== "#N/A") ? (parseInt(String(val).replace(/,/g, "")) || 0) : 0;
        });
        weekly.push(w);
      } catch(e) {}
    }
  }

  // 2. Marketing KPI
  const mktRows = mktSS.getSheets()[0].getRange("A1:Z25").getValues();
  const channels = [];
  let totals = {};
  const validTypes = ["Organic","Paid Ads","Influencer","Event","affilate"];

  for (let i = 1; i < mktRows.length; i++) {
    const row = mktRows[i];
    const rtype = String(row[1] || "").trim();
    const rchan = String(row[2] || "").trim();

    if (validTypes.includes(rtype) && rchan) {
      channels.push({
        type: rtype,
        channel: rchan,
        monthly_cost_usd: String(row[3] || "").trim(),
        traffic_forecast: parseInt(String(row[5] || "0").replace(/[,$]/g, "")) || 0,
        as_is_conv: String(row[7] || "").trim(),
        to_be_conv: String(row[8] || "").trim(),
        signup_forecast: parseInt(String(row[9] || "0").replace(/[,$]/g, "")) || 0,
      });
    }

    if (rtype.includes("Toal") || rtype.includes("Total")) {
      totals = {
        monthly_cost_usd: String(row[3] || "").trim(),
        traffic: parseInt(String(row[5] || "0").replace(/[,$]/g, "")) || 0,
        signups: parseInt(String(row[9] || "0").replace(/[,$]/g, "")) || 0,
      };
    }
  }

  // Build funnel
  const on = (health["Onboarding"] || {}).total || 0;
  const act = (health["Active"] || {}).total || 0;
  const paid = (health["Paid"] || {}).total || 0;
  const crOn = (health["Churn Risk - Onboarding"] || {}).total || 0;
  const crAct = (health["Churn Risk - Activation"] || {}).total || 0;
  const churned = (health["Churned"] || {}).total || 0;

  return {
    synced_at: new Date().toISOString(),
    funnel: {
      total_orgs: on + act + paid + crOn + crAct + churned,
      onboarding: on,
      active: act,
      paid: paid,
      churn_risk_onboarding: crOn,
      churn_risk_activation: crAct,
      churned: churned,
    },
    health: health,
    countries: countries.slice(0, 20),
    weekly_trend: weekly.slice(-12),
    marketing: {
      channels: channels,
      totals: totals,
      conversion_goal_monthly: 700,
    },
    targets: {
      mrr: 35000,
      paid_orgs: 80,
      monthly_signups: 700,
      arppu: 500,
      deadline: "2026-09-30",
    },
  };
}

// Test function — run in Apps Script editor to verify
function testBuild() {
  const data = buildData();
  Logger.log(JSON.stringify(data, null, 2));
  Logger.log("Total Orgs: " + data.funnel.total_orgs);
  Logger.log("Paid: " + data.funnel.paid);
  Logger.log("Channels: " + data.marketing.channels.length);
}
