/**
 * Core Plan Full Funnel Dashboard — Apps Script Backend
 *
 * 아키텍처: Amplitude API + Google Sheets → 통합 JSON → GitHub Pages
 *
 * 셋업:
 * 1. https://script.google.com → 새 프로젝트
 * 2. 이 코드 붙여넣기
 * 3. 프로젝트 설정 → 스크립트 속성에 추가:
 *    - AMP_API_KEY = bd2a2c0f2d8a19266fcd984528c8fdcf
 *    - AMP_SECRET_KEY = (Amplitude Settings에서 발급)
 * 4. Deploy → New deployment → Web app → Anyone → Deploy
 * 5. URL 복사 → index.html의 APPS_SCRIPT_URL에 붙여넣기
 */

// ========== CONFIG ==========
const AMPLITUDE_PROJECT = '385664';
const LEAD_SHEET_ID = '1y2MlUqSHYMSefkVFoxo6Kh5YYTFWvk00R__nUWH7Afw';
const MKT_SHEET_ID = '145fp9fBz8qszcjSd45azGk0gU_s8coPfzf8i-Do_l8M';

const FUNNEL_EVENTS = [
  { stage: 'visitor', event: '[Amplitude] Page Viewed', label: 'Visitors' },
  { stage: 'signup', event: '[App] signup_completed', label: 'Signups' },
  { stage: 'sdk_install', event: '[App] first_sdk_event_collected', label: 'SDK Installed' },
  { stage: 'activation', event: '[App] actuals_request_complete', label: 'Activated' },
];

const BENCHMARKS = {
  'visitor_to_signup': { benchmark: 0.05, target: 0.03 },
  'signup_to_sdk_install': { benchmark: 0.15, target: 0.20 },
  'sdk_install_to_activation': { benchmark: 0.50, target: 0.50 },
  'activation_to_paid': { benchmark: 0.10, target: 0.10 },
  'sdk_install_to_paid': { benchmark: 0.02, target: 0.05 },
};

const TARGETS = {
  mrr: 35000,
  paid_orgs: 80,
  monthly_signups: 700,
  monthly_visitors: 11000,
  arppu: 500,
  deadline: '2026-09-30',
};

// ========== ENTRY POINT ==========
function doGet(e) {
  try {
    const data = buildDashboardData();
    return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message, stack: err.stack }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ========== MAIN DATA BUILDER ==========
function buildDashboardData() {
  const amplitude = fetchAmplitudeData();
  const sheets = fetchSheetsData();

  // Build funnel with conversion rates
  const funnel = buildFunnel(amplitude, sheets);

  return {
    synced_at: new Date().toISOString(),
    funnel: funnel,
    amplitude: amplitude,
    org_health: sheets.health,
    weekly_trend: sheets.weekly,
    marketing: sheets.marketing,
    countries: sheets.countries,
    benchmarks: BENCHMARKS,
    targets: TARGETS,
    dri: {
      traffic: ['슬(Seul)', '재혁(Jaehyuk)', '채건(Chaigun)'],
      sdk_install: ['승헌(Seungheon)', 'Agent팀'],
      paid: ['Amy', '현탁(Hyeontak)'],
      owner: '현종(Hyunjong)',
    },
  };
}

// ========== AMPLITUDE API (직접 호출) ==========
// Script Properties에 AMP_API_KEY + AMP_SECRET_KEY 설정 필요
// 자동 싱크: 트리거 → dailySync() 매일 아침 실행
function fetchAmplitudeData() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('AMP_API_KEY');
  const secretKey = props.getProperty('AMP_SECRET_KEY');

  if (!apiKey || !secretKey) {
    // Fallback: Simulation 탭에서 읽기
    return fetchAmplitudeFromSheet_();
  }

  try {
    const auth = Utilities.base64Encode(apiKey + ':' + secretKey);
    const now = new Date();
    const start = formatDate(new Date(now.getTime() - 30 * 86400000));
    const end = formatDate(now);

    const events = [
      { key: 'visitor', event: '[Amplitude] Page Viewed', label: '방문자', filter: 'country_ex_kr' },
      { key: 'signup', event: 'signup_completed', label: '가입', filter: 'country_ex_kr' },
      { key: 'sdk_install', event: 'first_sdk_event_collected', label: 'SDK 설치', filter: null },
      { key: 'activation', event: 'actuals_request_complete', label: 'Activation', filter: null },
    ];

    const results = {};

    for (const ev of events) {
      // Build segmentation query
      const eParam = JSON.stringify({ event_type: ev.event });
      let url = 'https://amplitude.com/api/2/events/segmentation?e=' + encodeURIComponent(eParam)
        + '&start=' + start + '&end=' + end + '&m=uniques&i=7';

      // Add country filter for visitor/signup (exclude South Korea)
      if (ev.filter === 'country_ex_kr') {
        const seg = JSON.stringify({ prop: 'country', op: 'is not', values: ['South Korea'] });
        url += '&s=' + encodeURIComponent('[' + seg + ']');
      }

      const response = UrlFetchApp.fetch(url, {
        headers: { 'Authorization': 'Basic ' + auth },
        muteHttpExceptions: true,
      });

      const json = JSON.parse(response.getContentText());
      if (json.data && json.data.series && json.data.series[0]) {
        const weekly = json.data.series[0];
        const total = weekly.reduce((a, b) => a + b, 0);
        results[ev.key] = {
          label: ev.label,
          event: ev.event,
          count_30d: total,
          weekly: weekly,
        };
      } else {
        results[ev.key] = { label: ev.label, event: ev.event, count_30d: 0, weekly: [], error: json.error };
      }

      // Also fetch US-only for visitor and signup
      if (ev.filter === 'country_ex_kr') {
        const segUS = JSON.stringify({ prop: 'country', op: 'is', values: ['United States'] });
        const urlUS = 'https://amplitude.com/api/2/events/segmentation?e=' + encodeURIComponent(eParam)
          + '&start=' + start + '&end=' + end + '&m=uniques&i=7'
          + '&s=' + encodeURIComponent('[' + segUS + ']');

        const resUS = UrlFetchApp.fetch(urlUS, {
          headers: { 'Authorization': 'Basic ' + auth },
          muteHttpExceptions: true,
        });
        const jsonUS = JSON.parse(resUS.getContentText());
        if (jsonUS.data && jsonUS.data.series && jsonUS.data.series[0]) {
          const weeklyUS = jsonUS.data.series[0];
          results[ev.key].count_30d_us = weeklyUS.reduce((a, b) => a + b, 0);
          results[ev.key].weekly_us = weeklyUS;
          results[ev.key].count_30d_global_ex_kr = results[ev.key].count_30d;
        }
      }
    }

    return results;
  } catch (e) {
    return { error: 'Amplitude API failed: ' + e.message };
  }
}

// Fallback: Simulation 탭에서 읽기
function fetchAmplitudeFromSheet_() {
  try {
    const ss = SpreadsheetApp.openById(LEAD_SHEET_ID);
    const sheet = ss.getSheetByName('Simulation');
    if (!sheet) return { error: 'Simulation tab not found' };

    const data = sheet.getRange('A1:F7').getValues();
    const weekly = sheet.getRange('A9:F13').getValues();

    const results = {};
    const stageMap = {
      'Visitor': 'visitor',
      'Signup': 'signup',
      'SDK Install': 'sdk_install',
      'Activation': 'activation',
      'Paid (Self-Serve)': 'paid_self_serve',
    };

    for (let i = 2; i < data.length; i++) {
      const row = data[i];
      const stage = stageMap[row[0]];
      if (!stage) continue;
      results[stage] = {
        label: row[0],
        event: row[1],
        count_30d: toInt(row[2]),
        weekly_avg: toInt(row[3]),
        conv_rate: row[4] || null,
        status: row[5] || null,
      };
    }

    if (weekly.length >= 5) {
      const weeks = weekly[0].slice(1).filter(w => w);
      results.weeks = weeks.map(String);
      const weeklyData = {};
      for (let i = 1; i < weekly.length; i++) {
        const name = String(weekly[i][0]).toLowerCase().replace(/ /g, '_');
        weeklyData[name] = weekly[i].slice(1).map(toInt);
      }
      // Attach weekly arrays
      if (results.visitor) results.visitor.weekly = weeklyData.visitors || [];
      if (results.signup) results.signup.weekly = weeklyData.signups || [];
      if (results.sdk_install) results.sdk_install.weekly = weeklyData.sdk_install || [];
      if (results.activation) results.activation.weekly = weeklyData.activation || [];
    }

    return results;
  } catch (e) {
    return { error: 'Failed to read Simulation tab: ' + e.message };
  }
}

// Amplitude API 함수 제거됨 — Secret Key 없이 운영
// Amplitude 데이터는 Claude Code MCP → Simulation 탭 → 이 스크립트가 읽음

// ========== GOOGLE SHEETS ==========
function fetchSheetsData() {
  const result = { health: {}, weekly: [], countries: [], marketing: {} };

  try {
    // Lead Measure Sheet — Overview tab
    const leadSS = SpreadsheetApp.openById(LEAD_SHEET_ID);
    const ov = leadSS.getSheetByName('Overview').getRange('A1:Q30').getValues();

    // Health Status (cols E-H)
    const health = {};
    for (let i = 1; i < ov.length; i++) {
      const row = ov[i];
      if (row[4] && row[5]) {
        try {
          health[row[4]] = {
            total: toInt(row[5]),
            self_serve: toInt(row[6]),
            contract: toInt(row[7]),
          };
        } catch (e) {}
      }
    }

    // Weekly Trend (cols J-Q)
    const weekly = [];
    for (let i = 1; i < ov.length; i++) {
      const row = ov[i];
      const ws = row[9];
      if (ws && !['week_start', 'Total', '총계'].includes(String(ws))) {
        try {
          const w = {
            week: ws instanceof Date ? Utilities.formatDate(ws, 'Asia/Seoul', 'yyyy-MM-dd') : String(ws),
            total: toInt(row[10]),
            onboarding: toInt(row[11]),
            churn_risk_onboarding: toInt(row[12]),
            active: toInt(row[13]),
            churn_risk_activation: toInt(row[14]),
            paid: toInt(row[15]),
            churned: toInt(row[16]),
          };
          weekly.push(w);
        } catch (e) {}
      }
    }

    // Countries (cols A-D)
    const countries = [];
    for (let i = 1; i < ov.length; i++) {
      const row = ov[i];
      if (row[0] && row[1] && !['Total', ''].includes(String(row[0]))) {
        try {
          countries.push({
            country: String(row[0]),
            orgs: toInt(row[1]),
            active: toInt(row[2]),
            active_pct: String(row[3] || '0%'),
          });
        } catch (e) {}
      }
    }

    // Funnel from health
    const on = (health['Onboarding'] || {}).total || 0;
    const act = (health['Active'] || {}).total || 0;
    const paid = (health['Paid'] || {}).total || 0;
    const crOn = (health['Churn Risk - Onboarding'] || {}).total || 0;
    const crAct = (health['Churn Risk - Activation'] || {}).total || 0;
    const churned = (health['Churned'] || {}).total || 0;

    result.health = {
      total_orgs: on + act + paid + crOn + crAct + churned,
      onboarding: on,
      active: act,
      paid: paid,
      paid_self_serve: (health['Paid'] || {}).self_serve || 0,
      paid_contract: (health['Paid'] || {}).contract || 0,
      churn_risk_onboarding: crOn,
      churn_risk_activation: crAct,
      churned: churned,
      raw: health,
    };
    result.weekly = weekly.slice(-12);
    result.countries = countries.slice(0, 20);
  } catch (e) {
    result.health = { error: e.message };
  }

  try {
    // Marketing KPI Sheet
    const mktSS = SpreadsheetApp.openById(MKT_SHEET_ID);
    const mktRows = mktSS.getSheets()[0].getRange('A1:Z25').getValues();

    const channels = [];
    let totals = {};
    const validTypes = ['Organic', 'Paid Ads', 'Influencer', 'Event', 'affilate'];

    for (let i = 1; i < mktRows.length; i++) {
      const row = mktRows[i];
      const rtype = String(row[1] || '').trim();
      const rchan = String(row[2] || '').trim();

      if (validTypes.includes(rtype) && rchan) {
        channels.push({
          type: rtype,
          channel: rchan,
          monthly_cost_usd: String(row[3] || '').trim(),
          traffic_forecast: toInt(row[5]),
          as_is_conv: String(row[7] || '').trim(),
          to_be_conv: String(row[8] || '').trim(),
          signup_forecast: toInt(row[9]),
        });
      }
      if (rtype.includes('Toal') || rtype.includes('Total')) {
        totals = {
          monthly_cost_usd: String(row[3] || '').trim(),
          traffic: toInt(row[5]),
          signups: toInt(row[9]),
        };
      }
    }

    result.marketing = {
      channels: channels,
      totals: totals,
      conversion_goal_monthly: 700,
    };
  } catch (e) {
    result.marketing = { error: e.message };
  }

  return result;
}

// ========== FUNNEL BUILDER ==========
function buildFunnel(amplitude, sheets) {
  const stages = [];
  const stageKeys = ['visitor', 'signup', 'sdk_install', 'activation'];

  for (let i = 0; i < stageKeys.length; i++) {
    const key = stageKeys[i];
    const amp = amplitude[key] || {};
    const count30 = amp.count_30d || 0;
    const count7 = amp.count_7d || 0;
    const monthly = Math.round(count30); // ~30 days
    const wow = amp.wow_change;

    let convRate = null;
    let convKey = null;
    let benchmark = null;
    let target = null;
    let status = 'gray'; // gray = no data

    if (i > 0) {
      const prevAmp = amplitude[stageKeys[i - 1]] || {};
      const prevCount = prevAmp.count_30d || 0;
      convRate = prevCount > 0 ? count30 / prevCount : 0;
      convKey = stageKeys[i - 1] + '_to_' + key;
      const bm = BENCHMARKS[convKey];
      if (bm) {
        benchmark = bm.benchmark;
        target = bm.target;
        const ratio = benchmark > 0 ? convRate / benchmark : 0;
        status = ratio >= 0.8 ? 'green' : ratio >= 0.4 ? 'yellow' : 'red';
      }
    }

    stages.push({
      key: key,
      label: amp.label || key,
      count_30d: count30,
      count_7d: count7,
      monthly_estimate: monthly,
      wow_change: wow,
      conv_rate: convRate,
      conv_key: convKey,
      benchmark: benchmark,
      target: target,
      status: status,
      daily: amp.daily || [],
    });
  }

  // Add Paid stage from sheets
  const paidOrgs = sheets.health.paid_self_serve || 0;
  const paidTotal = sheets.health.paid || 0;
  const sdkCount = (amplitude['sdk_install'] || {}).count_30d || 1;
  const paidConvRate = sdkCount > 0 ? paidOrgs / sdkCount : 0;
  const paidBm = BENCHMARKS['sdk_install_to_paid'];

  stages.push({
    key: 'paid',
    label: 'Paid Orgs',
    count_30d: paidTotal,
    count_7d: null,
    monthly_estimate: paidTotal,
    self_serve: paidOrgs,
    contract: sheets.health.paid_contract || 0,
    wow_change: null,
    conv_rate: paidConvRate,
    conv_key: 'sdk_install_to_paid',
    benchmark: paidBm ? paidBm.benchmark : null,
    target: paidBm ? paidBm.target : null,
    status: paidBm ? (paidConvRate / paidBm.benchmark >= 0.8 ? 'green' : paidConvRate / paidBm.benchmark >= 0.4 ? 'yellow' : 'red') : 'gray',
    daily: [],
    source: 'sheets',
    note: 'Stripe 미연동 — 시트 데이터 기반 (self-serve만 PLG 카운트)',
  });

  // Calculate MRR
  const mrr = paidOrgs * TARGETS.arppu;
  const mrrPct = Math.min(100, (mrr / TARGETS.mrr) * 100);

  // Find worst bottleneck
  const bottleneckStages = stages.filter(s => s.status === 'red');
  const worstBottleneck = bottleneckStages.length > 0
    ? bottleneckStages.reduce((worst, s) => {
        const ratio = s.benchmark > 0 ? (s.conv_rate || 0) / s.benchmark : 1;
        const worstRatio = worst.benchmark > 0 ? (worst.conv_rate || 0) / worst.benchmark : 1;
        return ratio < worstRatio ? s : worst;
      })
    : null;

  // E2E conversion
  const visitorCount = (amplitude['visitor'] || {}).count_30d || 1;
  const e2eConv = paidOrgs / visitorCount;

  return {
    stages: stages,
    mrr: {
      current: mrr,
      target: TARGETS.mrr,
      pct: mrrPct,
    },
    e2e_conv: e2eConv,
    worst_bottleneck: worstBottleneck ? worstBottleneck.conv_key : null,
  };
}

// ========== HELPERS ==========
function formatDate(d) {
  return Utilities.formatDate(d, 'UTC', 'yyyyMMdd');
}

function buildQuery(params) {
  return Object.entries(params)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
}

function toInt(val) {
  if (val === null || val === undefined || val === '' || val === '#N/A') return 0;
  const n = parseInt(String(val).replace(/[,%$]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

// ========== TEST FUNCTION ==========
// ========== 자동 싱크 트리거 설정 ==========
// 1회만 실행하면 됨. 매일 오전 8-9시(KST) 자동 실행 등록.
function setupDailyTrigger() {
  // 기존 트리거 제거
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'dailySync') ScriptApp.deleteTrigger(t);
  });
  // 매일 오전 8-9시(KST = UTC-15 → 한국 시간)
  ScriptApp.newTrigger('dailySync')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .inTimezone('Asia/Seoul')
    .create();
  Logger.log('Daily sync trigger created: 매일 오전 8-9시 KST');
}

// 매일 자동 실행 — Amplitude 데이터를 Simulation 탭에 기록
function dailySync() {
  const amp = fetchAmplitudeData();
  if (amp.error) {
    Logger.log('dailySync failed: ' + amp.error);
    return;
  }

  // Simulation 탭에 기록
  const ss = SpreadsheetApp.openById(LEAD_SHEET_ID);
  let sheet = ss.getSheetByName('Simulation');
  if (!sheet) sheet = ss.insertSheet('Simulation');

  const vis = amp.visitor || {};
  const sig = amp.signup || {};
  const sdk = amp.sdk_install || {};
  const act = amp.activation || {};

  const rows = [
    ['Amplitude Funnel Data', 'Auto-synced: ' + new Date().toISOString()],
    ['Stage', 'Event', '30d Uniques', 'US 30d', 'Global(exKR) 30d', 'Status'],
    ['Visitor', 'Page Viewed', vis.count_30d_global_ex_kr || vis.count_30d || 0, vis.count_30d_us || 0, vis.count_30d_global_ex_kr || vis.count_30d || 0, ''],
    ['Signup', 'signup_completed', sig.count_30d_global_ex_kr || sig.count_30d || 0, sig.count_30d_us || 0, sig.count_30d_global_ex_kr || sig.count_30d || 0, ''],
    ['SDK Install', 'first_sdk_event_collected', sdk.count_30d || 0, '', '', ''],
    ['Activation', 'actuals_request_complete', act.count_30d || 0, '', '', ''],
    [''],
    ['Weekly (Global exKR)', ...((vis.weekly || []).length > 0 ? vis.weekly.map((_, i) => 'W' + (i + 1)) : ['W1', 'W2', 'W3', 'W4', 'W5'])],
    ['Visitors', ...(vis.weekly || [])],
    ['Signups', ...(sig.weekly || [])],
    ['SDK Install', ...(sdk.weekly || [])],
    ['Activation', ...(act.weekly || [])],
  ];

  sheet.getRange(1, 1, rows.length, Math.max(...rows.map(r => r.length))).setValues(
    rows.map(r => { while (r.length < Math.max(...rows.map(r2 => r2.length))) r.push(''); return r; })
  );

  Logger.log('dailySync complete: Visitor=' + (vis.count_30d || 0) + ', Signup=' + (sig.count_30d || 0));
}

// ========== TEST ==========
function testBuild() {
  const data = buildDashboardData();
  Logger.log('=== Funnel ===');
  data.funnel.stages.forEach(s => {
    Logger.log(`${s.label}: ${s.count_30d} (${s.status}) conv=${s.conv_rate ? (s.conv_rate * 100).toFixed(2) + '%' : 'N/A'}`);
  });
  Logger.log('MRR: $' + data.funnel.mrr.current + ' / $' + data.funnel.mrr.target + ' (' + data.funnel.mrr.pct.toFixed(1) + '%)');
  Logger.log('Worst bottleneck: ' + data.funnel.worst_bottleneck);
  Logger.log('Amplitude: ' + JSON.stringify(Object.keys(data.amplitude || {})));
  Logger.log('Org Health: paid=' + (data.org_health || {}).paid);
  Logger.log('Marketing channels: ' + (data.marketing.channels || []).length);
}
