#!/bin/bash
# Amplitude 데이터를 Google Sheet에 쓰는 스크립트
# Claude Code에서 실행: bash scripts/sync-amplitude.sh
# 또는 /loop 1h bash scripts/sync-amplitude.sh

set -e
cd "$(dirname "$0")/.."
SHEET_ID="1y2MlUqSHYMSefkVFoxo6Kh5YYTFWvk00R__nUWH7Afw"
TAB="Simulation"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "Syncing Amplitude data to Google Sheet..."
echo "  Run 'claude' and ask: 'Amplitude 퍼널 데이터 시트에 싱크해줘'"
echo "  Or use Amplitude MCP query_dataset to get latest numbers"
echo ""
echo "Last manual sync: check ${TAB} tab in the sheet"
echo "Sheet: https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit"
