import { runPythonScript } from './pythonViz.js';
import { pool, sanitizeIdentifier } from './db.js';

// ─── Time-Series Forecasting Service ─────────────────────────────────────────

/**
 * Performs time-series forecasting using various methods.
 * Supports: linear trend, exponential smoothing, moving average, and auto-detection.
 */
export async function generateForecast(params) {
  const { tableName, dateColumn, valueColumn, periods = 12, method = 'auto' } = params;

  const safeTbl = sanitizeIdentifier(tableName);
  const safeDate = sanitizeIdentifier(dateColumn);
  const safeVal = sanitizeIdentifier(valueColumn);

  // Fetch time-series data ordered by date
  const [data] = await pool.execute(
    `SELECT \`${safeDate}\` as date_val, CAST(\`${safeVal}\` AS DECIMAL(18,4)) as num_val 
     FROM \`${safeTbl}\` 
     WHERE \`${safeDate}\` IS NOT NULL AND \`${safeVal}\` IS NOT NULL 
     ORDER BY \`${safeDate}\` ASC`
  );

  if (data.length < 5) {
    throw new Error('Need at least 5 data points for forecasting. Current: ' + data.length);
  }

  const timeSeriesData = data.map(r => ({
    date: String(r.date_val),
    value: parseFloat(r.num_val)
  }));

  const pythonCode = `
import sys
import json
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

with open(sys.argv[1], 'r') as f:
    params = json.load(f)

data = params['data']
periods = params['periods']
method = params['method']

# Parse dates and values
df = pd.DataFrame(data)
df['date'] = pd.to_datetime(df['date'], errors='coerce')
df = df.dropna(subset=['date'])
df = df.sort_values('date').reset_index(drop=True)
df['value'] = df['value'].astype(float)

values = df['value'].values
dates = df['date'].values

# Determine frequency
if len(dates) >= 2:
    diffs = np.diff(dates.astype('datetime64[D]').astype(int))
    median_diff = int(np.median(diffs))
    if median_diff <= 1:
        freq = 'D'
    elif median_diff <= 8:
        freq = 'W'
    elif median_diff <= 35:
        freq = 'M'
    elif median_diff <= 100:
        freq = 'Q'
    else:
        freq = 'Y'
else:
    freq = 'M'

# Auto-select method
if method == 'auto':
    if len(values) >= 24:
        method = 'holt_winters'
    elif len(values) >= 10:
        method = 'exponential_smoothing'
    else:
        method = 'linear_trend'

forecast_values = []
confidence_lower = []
confidence_upper = []

if method == 'holt_winters' or method == 'exponential_smoothing':
    try:
        # Simple exponential smoothing implementation (no statsmodels needed)
        alpha = 0.3
        beta = 0.1
        level = values[0]
        trend = (values[-1] - values[0]) / len(values) if len(values) > 1 else 0
        
        fitted = []
        for v in values:
            last_level = level
            level = alpha * v + (1 - alpha) * (level + trend)
            trend = beta * (level - last_level) + (1 - beta) * trend
            fitted.append(level + trend)
        
        forecast_values = [level + trend * (i + 1) for i in range(periods)]
        
        residuals = values - np.array(fitted)
        std_resid = float(np.std(residuals))
        confidence_lower = [v - 1.96 * std_resid for v in forecast_values]
        confidence_upper = [v + 1.96 * std_resid for v in forecast_values]
    except Exception as e:
        method = 'linear_trend'

if method == 'linear_trend':
    x = np.arange(len(values))
    coeffs = np.polyfit(x, values, 1)
    future_x = np.arange(len(values), len(values) + periods)
    forecast_values = np.polyval(coeffs, future_x).tolist()
    
    residuals = values - np.polyval(coeffs, x)
    std_resid = float(np.std(residuals))
    confidence_lower = [v - 1.96 * std_resid for v in forecast_values]
    confidence_upper = [v + 1.96 * std_resid for v in forecast_values]

elif method == 'moving_average':
    window = min(5, len(values) // 2)
    ma = pd.Series(values).rolling(window=window).mean().dropna().values
    last_ma = float(ma[-1])
    trend = float(ma[-1] - ma[0]) / len(ma) if len(ma) > 1 else 0
    forecast_values = [last_ma + trend * (i + 1) for i in range(periods)]
    
    std_resid = float(np.std(values[-window:]))
    confidence_lower = [v - 1.96 * std_resid for v in forecast_values]
    confidence_upper = [v + 1.96 * std_resid for v in forecast_values]

# Generate future dates
last_date = pd.Timestamp(dates[-1])
if freq == 'D':
    future_dates = [last_date + timedelta(days=i+1) for i in range(periods)]
elif freq == 'W':
    future_dates = [last_date + timedelta(weeks=i+1) for i in range(periods)]
elif freq == 'M':
    future_dates = [last_date + pd.DateOffset(months=i+1) for i in range(periods)]
elif freq == 'Q':
    future_dates = [last_date + pd.DateOffset(months=(i+1)*3) for i in range(periods)]
else:
    future_dates = [last_date + pd.DateOffset(years=i+1) for i in range(periods)]

# Summary statistics
trend_direction = "increasing" if forecast_values[-1] > values[-1] else "decreasing" if forecast_values[-1] < values[-1] else "stable"
pct_change = ((forecast_values[-1] - values[-1]) / abs(values[-1]) * 100) if values[-1] != 0 else 0

result = {
    "method": method,
    "frequency": freq,
    "historical": {
        "dates": [str(d)[:10] for d in df['date'].tolist()],
        "values": [round(v, 2) for v in values.tolist()]
    },
    "forecast": {
        "dates": [str(d)[:10] for d in future_dates],
        "values": [round(v, 2) for v in forecast_values],
        "confidence_lower": [round(v, 2) for v in confidence_lower],
        "confidence_upper": [round(v, 2) for v in confidence_upper]
    },
    "summary": {
        "trend": trend_direction,
        "forecast_periods": periods,
        "last_actual": round(float(values[-1]), 2),
        "last_forecast": round(float(forecast_values[-1]), 2),
        "percentage_change": round(float(pct_change), 2),
        "data_points_used": len(values)
    }
}
print(json.dumps(result))
`;

  return await runPythonScript(pythonCode, {
    data: timeSeriesData,
    periods,
    method
  });
}

// ─── Feature Importance (Simple Regression-Based) ────────────────────────────

export async function getFeatureImportance(params) {
  const { tableName, targetColumn } = params;
  const safeTbl = sanitizeIdentifier(tableName);
  const safeTarget = sanitizeIdentifier(targetColumn);

  // Get all numeric columns except target
  const [columns] = await pool.execute(`SHOW COLUMNS FROM \`${safeTbl}\``);
  const numericCols = columns
    .filter(c => c.Field !== '__row_id' && c.Field !== targetColumn)
    .filter(c => {
      const t = c.Type.toLowerCase();
      return t.includes('int') || t.includes('decimal') || t.includes('float') || t.includes('double');
    })
    .map(c => c.Field);

  if (numericCols.length === 0) {
    throw new Error('No numeric feature columns found for importance analysis');
  }

  const selectCols = [safeTarget, ...numericCols].map(c => `\`${c}\``).join(', ');
  const [data] = await pool.execute(
    `SELECT ${selectCols} FROM \`${safeTbl}\` WHERE \`${safeTarget}\` IS NOT NULL LIMIT 50000`
  );

  const pythonCode = `
import sys
import json
import numpy as np
import pandas as pd

with open(sys.argv[1], 'r') as f:
    params = json.load(f)

df = pd.DataFrame(params['data'])
target = params['target']
features = params['features']

# Drop rows with any null in features or target
df = df.dropna(subset=[target] + features)

if len(df) < 10:
    print(json.dumps({"error": "Insufficient data (need at least 10 complete rows)"}))
else:
    y = df[target].astype(float).values
    
    # Correlation-based feature importance (no sklearn needed)
    feature_ranking = []
    for feat in features:
        x = df[feat].astype(float).values
        # Pearson correlation as importance proxy
        corr = np.corrcoef(x, y)[0, 1] if np.std(x) > 0 else 0
        feature_ranking.append({
            "feature": feat,
            "importance": round(abs(float(corr)), 4),
            "correlation": round(float(corr), 4),
            "percentage": round(abs(float(corr)) * 100, 1)
        })
    
    feature_ranking.sort(key=lambda x: x["importance"], reverse=True)
    
    result = {
        "method": "Correlation-Based Feature Importance",
        "target": target,
        "n_samples": len(df),
        "features": feature_ranking
    }
    print(json.dumps(result))
`;

  return await runPythonScript(pythonCode, {
    data: data.map(r => {
      const row = {};
      row[targetColumn] = r[targetColumn];
      numericCols.forEach(c => { row[c] = r[c]; });
      return row;
    }),
    target: targetColumn,
    features: numericCols
  });
}

// ─── Auto-Detect Time Columns ────────────────────────────────────────────────

export async function detectTimeColumns(tableName) {
  const safeTbl = sanitizeIdentifier(tableName);
  const [columns] = await pool.execute(`SHOW COLUMNS FROM \`${safeTbl}\``);

  const timeColumns = [];
  for (const col of columns) {
    if (col.Field === '__row_id') continue;
    const t = col.Type.toLowerCase();
    if (t.includes('date') || t.includes('time') || t.includes('timestamp')) {
      timeColumns.push({ name: col.Field, type: col.Type, confidence: 'high' });
    } else if (col.Field.toLowerCase().includes('date') || col.Field.toLowerCase().includes('time') || col.Field.toLowerCase().includes('year') || col.Field.toLowerCase().includes('month')) {
      timeColumns.push({ name: col.Field, type: col.Type, confidence: 'medium' });
    }
  }

  return timeColumns;
}
