#!/bin/bash
# Core Plan Full Funnel Dashboard — Data Sync
# Run: bash scripts/sync-data.sh

set -e
cd "$(dirname "$0")/.."

LEAD_SHEET="1y2MlUqSHYMSefkVFoxo6Kh5YYTFWvk00R__nUWH7Afw"
MKT_SHEET="145fp9fBz8qszcjSd45azGk0gU_s8coPfzf8i-Do_l8M"
TMP_DIR=$(mktemp -d)

echo "Syncing data..."

echo "  [1/3] Lead Measure Overview..."
gws sheets spreadsheets values get \
  --params "{\"spreadsheetId\":\"$LEAD_SHEET\",\"range\":\"Overview!A1:Q30\"}" \
  2>/dev/null > "$TMP_DIR/overview.json"

echo "  [2/3] Marketing KPI..."
gws sheets spreadsheets values get \
  --params "{\"spreadsheetId\":\"$MKT_SHEET\",\"range\":\"A1:Z25\"}" \
  2>/dev/null > "$TMP_DIR/mkt.json"

echo "  [3/3] Building data.json..."

export TMP_DIR
python3 << 'PYEOF'
import json, sys, os
from datetime import datetime, timezone

tmp = os.environ["TMP_DIR"]

with open(f"{tmp}/overview.json") as f:
    overview = json.load(f)
with open(f"{tmp}/mkt.json") as f:
    mkt = json.load(f)

ov = overview.get("values", [])

# Parse health status (columns E-H)
health = {}
for row in ov[1:]:
    if len(row) >= 8 and row[4] and row[5]:
        try:
            health[row[4]] = {
                "total": int(str(row[5]).replace(",","")),
                "self_serve": int(str(row[6]).replace(",","")) if len(row)>6 and row[6] else 0,
                "contract": int(str(row[7]).replace(",","")) if len(row)>7 and row[7] else 0,
            }
        except:
            pass

# Parse weekly trend (columns J-Q)
weekly_trend = []
for row in ov[1:]:
    if len(row) >= 11 and row[9] and row[9] not in ("week_start","Total","총계"):
        try:
            week = {"week": row[9], "total": int(str(row[10]).replace(",",""))}
            stages = ["onboarding","churn_risk_onboarding","active","churn_risk_activation","paid","churned"]
            for i, s in enumerate(stages):
                val = row[11+i] if len(row) > 11+i else ""
                week[s] = int(str(val).replace(",","")) if val and val != "#N/A" else 0
            weekly_trend.append(week)
        except:
            pass

# Parse country data (columns A-D)
countries = []
for row in ov[1:]:
    if len(row) >= 3 and row[0] and row[0] not in ("", "Total"):
        try:
            countries.append({
                "country": row[0],
                "orgs": int(str(row[1]).replace(",","")),
                "active": int(str(row[2]).replace(",","")),
                "active_pct": row[3] if len(row)>3 else "0%"
            })
        except:
            pass

# Parse marketing KPI (skip header rows)
mkt_rows = mkt.get("values", [])
channels = []
totals = {}
valid_types = ("Organic","Paid Ads","Influencer","Event","affilate")
for row in mkt_rows:
    if len(row) < 3:
        continue
    rtype = str(row[1]).strip() if len(row)>1 else ""
    rchan = str(row[2]).strip() if len(row)>2 else ""
    if rtype in valid_types and rchan:
        def safe_int(v):
            try: return int(str(v).replace(",","").replace("$","").strip())
            except: return 0
        channels.append({
            "type": rtype,
            "channel": rchan,
            "monthly_cost_usd": row[3].strip() if len(row)>3 else "",
            "traffic_forecast": safe_int(row[5]) if len(row)>5 else 0,
            "as_is_conv": row[7].strip() if len(row)>7 else "",
            "to_be_conv": row[8].strip() if len(row)>8 else "",
            "signup_forecast": safe_int(row[9]) if len(row)>9 else 0,
        })
    if rtype and "Toal" in rtype:
        def safe_int2(v):
            try: return int(str(v).replace(",","").replace("$","").strip())
            except: return 0
        totals = {
            "monthly_cost_usd": row[3].strip() if len(row)>3 else "",
            "traffic": safe_int2(row[5]) if len(row)>5 else 0,
            "signups": safe_int2(row[9]) if len(row)>9 else 0,
        }

# Funnel summary
on = health.get("Onboarding",{}).get("total",0)
act = health.get("Active",{}).get("total",0)
paid = health.get("Paid",{}).get("total",0)
cr_on = health.get("Churn Risk - Onboarding",{}).get("total",0)
cr_act = health.get("Churn Risk - Activation",{}).get("total",0)
churned = health.get("Churned",{}).get("total",0)
total = on + act + paid + cr_on + cr_act + churned

data = {
    "synced_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "funnel": {
        "total_orgs": total,
        "onboarding": on,
        "active": act,
        "paid": paid,
        "churn_risk_onboarding": cr_on,
        "churn_risk_activation": cr_act,
        "churned": churned,
    },
    "health": health,
    "countries": countries[:20],
    "weekly_trend": weekly_trend[-12:],
    "marketing": {
        "channels": channels,
        "totals": totals,
        "conversion_goal_monthly": 700,
    },
    "targets": {
        "mrr": 35000,
        "paid_orgs": 80,
        "monthly_signups": 700,
        "arppu": 500,
        "deadline": "2026-09-30",
    },
}

with open("data.json", "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

f = data["funnel"]
print(f"  Total Orgs: {f['total_orgs']}")
print(f"  Onboarding: {f['onboarding']} | Active: {f['active']} | Paid: {f['paid']}")
print(f"  Churned: {f['churned']}")
PYEOF

rm -rf "$TMP_DIR"
echo ""
echo "Done! data.json synced."
echo "Deploy: git add data.json && git commit -m 'data: sync $(date +%Y-%m-%d)' && git push"
