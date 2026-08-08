import { runPythonScript } from './pythonViz.js';
import { pool, sanitizeIdentifier } from './db.js';

// ─── Statistical Testing Service ─────────────────────────────────────────────

/**
 * Performs statistical hypothesis tests on table data.
 * Supports: t-test, chi-square, ANOVA, correlation, normality test
 */
export async function runStatisticalTest(testType, params) {
  switch (testType) {
    case 'ttest':
      return await twoSampleTTest(params);
    case 'paired_ttest':
      return await pairedTTest(params);
    case 'chi_square':
      return await chiSquareTest(params);
    case 'anova':
      return await anovaTest(params);
    case 'correlation':
      return await correlationTest(params);
    case 'normality':
      return await normalityTest(params);
    case 'mann_whitney':
      return await mannWhitneyTest(params);
    default:
      throw new Error(`Unsupported test type: ${testType}. Available: ttest, paired_ttest, chi_square, anova, correlation, normality, mann_whitney`);
  }
}

// ─── Two-Sample T-Test ───────────────────────────────────────────────────────

async function twoSampleTTest({ tableName, column, groupColumn, groupA, groupB }) {
  const safeTbl = sanitizeIdentifier(tableName);
  const safeCol = sanitizeIdentifier(column);
  const safeGroup = sanitizeIdentifier(groupColumn);

  const [dataA] = await pool.execute(
    `SELECT CAST(\`${safeCol}\` AS DECIMAL(18,4)) as val FROM \`${safeTbl}\` WHERE \`${safeGroup}\` = ? AND \`${safeCol}\` IS NOT NULL`,
    [groupA]
  );
  const [dataB] = await pool.execute(
    `SELECT CAST(\`${safeCol}\` AS DECIMAL(18,4)) as val FROM \`${safeTbl}\` WHERE \`${safeGroup}\` = ? AND \`${safeCol}\` IS NOT NULL`,
    [groupB]
  );

  const valuesA = dataA.map(r => parseFloat(r.val));
  const valuesB = dataB.map(r => parseFloat(r.val));

  if (valuesA.length < 2 || valuesB.length < 2) {
    throw new Error('Each group needs at least 2 data points for a t-test');
  }

  const pythonCode = `
import sys
import json
import numpy as np
from scipy import stats

with open(sys.argv[1], 'r') as f:
    data = json.load(f)

a = np.array(data['groupA'], dtype=float)
b = np.array(data['groupB'], dtype=float)

t_stat, p_value = stats.ttest_ind(a, b, equal_var=False)
cohens_d = (np.mean(a) - np.mean(b)) / np.sqrt((np.std(a)**2 + np.std(b)**2) / 2)

result = {
    "test": "Independent Two-Sample T-Test (Welch's)",
    "t_statistic": round(float(t_stat), 4),
    "p_value": round(float(p_value), 6),
    "significant": bool(p_value < 0.05),
    "effect_size_cohens_d": round(float(cohens_d), 4),
    "group_a": {"name": data['labelA'], "n": len(a), "mean": round(float(np.mean(a)), 4), "std": round(float(np.std(a)), 4)},
    "group_b": {"name": data['labelB'], "n": len(b), "mean": round(float(np.mean(b)), 4), "std": round(float(np.std(b)), 4)},
    "confidence_level": 0.95
}
print(json.dumps(result))
`;

  return await runPythonScript(pythonCode, { groupA: valuesA, groupB: valuesB, labelA: groupA, labelB: groupB });
}

// ─── Paired T-Test ───────────────────────────────────────────────────────────

async function pairedTTest({ tableName, columnA, columnB }) {
  const safeTbl = sanitizeIdentifier(tableName);
  const safeColA = sanitizeIdentifier(columnA);
  const safeColB = sanitizeIdentifier(columnB);

  const [data] = await pool.execute(
    `SELECT CAST(\`${safeColA}\` AS DECIMAL(18,4)) as a, CAST(\`${safeColB}\` AS DECIMAL(18,4)) as b 
     FROM \`${safeTbl}\` WHERE \`${safeColA}\` IS NOT NULL AND \`${safeColB}\` IS NOT NULL`
  );

  const valuesA = data.map(r => parseFloat(r.a));
  const valuesB = data.map(r => parseFloat(r.b));

  const pythonCode = `
import sys
import json
import numpy as np
from scipy import stats

with open(sys.argv[1], 'r') as f:
    data = json.load(f)

a = np.array(data['a'], dtype=float)
b = np.array(data['b'], dtype=float)

t_stat, p_value = stats.ttest_rel(a, b)
diff = a - b

result = {
    "test": "Paired T-Test",
    "t_statistic": round(float(t_stat), 4),
    "p_value": round(float(p_value), 6),
    "significant": bool(p_value < 0.05),
    "mean_difference": round(float(np.mean(diff)), 4),
    "std_difference": round(float(np.std(diff)), 4),
    "n_pairs": len(a),
    "confidence_level": 0.95
}
print(json.dumps(result))
`;

  return await runPythonScript(pythonCode, { a: valuesA, b: valuesB });
}

// ─── Chi-Square Test ─────────────────────────────────────────────────────────

async function chiSquareTest({ tableName, columnA, columnB }) {
  const safeTbl = sanitizeIdentifier(tableName);
  const safeColA = sanitizeIdentifier(columnA);
  const safeColB = sanitizeIdentifier(columnB);

  const [data] = await pool.execute(
    `SELECT \`${safeColA}\` as a, \`${safeColB}\` as b FROM \`${safeTbl}\` 
     WHERE \`${safeColA}\` IS NOT NULL AND \`${safeColB}\` IS NOT NULL LIMIT 10000`
  );

  const pythonCode = `
import sys
import json
import pandas as pd
from scipy import stats

with open(sys.argv[1], 'r') as f:
    data = json.load(f)

df = pd.DataFrame(data)
contingency = pd.crosstab(df['a'], df['b'])
chi2, p_value, dof, expected = stats.chi2_contingency(contingency)

cramers_v = float(np.sqrt(chi2 / (contingency.sum().sum() * (min(contingency.shape) - 1)))) if min(contingency.shape) > 1 else 0

import numpy as np
result = {
    "test": "Chi-Square Test of Independence",
    "chi2_statistic": round(float(chi2), 4),
    "p_value": round(float(p_value), 6),
    "degrees_of_freedom": int(dof),
    "significant": bool(p_value < 0.05),
    "cramers_v": round(cramers_v, 4),
    "contingency_shape": list(contingency.shape),
    "confidence_level": 0.95
}
print(json.dumps(result))
`;

  return await runPythonScript(pythonCode, data.map(r => ({ a: r.a, b: r.b })));
}

// ─── ANOVA ───────────────────────────────────────────────────────────────────

async function anovaTest({ tableName, valueColumn, groupColumn }) {
  const safeTbl = sanitizeIdentifier(tableName);
  const safeVal = sanitizeIdentifier(valueColumn);
  const safeGroup = sanitizeIdentifier(groupColumn);

  const [data] = await pool.execute(
    `SELECT \`${safeGroup}\` as grp, CAST(\`${safeVal}\` AS DECIMAL(18,4)) as val 
     FROM \`${safeTbl}\` WHERE \`${safeGroup}\` IS NOT NULL AND \`${safeVal}\` IS NOT NULL LIMIT 50000`
  );

  const pythonCode = `
import sys
import json
import numpy as np
from scipy import stats

with open(sys.argv[1], 'r') as f:
    data = json.load(f)

groups = {}
for row in data:
    g = str(row['grp'])
    if g not in groups:
        groups[g] = []
    groups[g].append(float(row['val']))

group_arrays = [np.array(v) for v in groups.values() if len(v) >= 2]
if len(group_arrays) < 2:
    print(json.dumps({"error": "Need at least 2 groups with 2+ values each"}))
else:
    f_stat, p_value = stats.f_oneway(*group_arrays)
    
    # Effect size (eta-squared)
    all_values = np.concatenate(group_arrays)
    grand_mean = np.mean(all_values)
    ss_between = sum(len(g) * (np.mean(g) - grand_mean)**2 for g in group_arrays)
    ss_total = np.sum((all_values - grand_mean)**2)
    eta_squared = ss_between / ss_total if ss_total > 0 else 0
    
    group_stats = []
    for name, vals in groups.items():
        if len(vals) >= 2:
            group_stats.append({"name": name, "n": len(vals), "mean": round(float(np.mean(vals)), 4), "std": round(float(np.std(vals)), 4)})
    
    result = {
        "test": "One-Way ANOVA",
        "f_statistic": round(float(f_stat), 4),
        "p_value": round(float(p_value), 6),
        "significant": bool(p_value < 0.05),
        "eta_squared": round(float(eta_squared), 4),
        "num_groups": len(group_arrays),
        "groups": group_stats[:20],
        "confidence_level": 0.95
    }
    print(json.dumps(result))
`;

  return await runPythonScript(pythonCode, data.map(r => ({ grp: r.grp, val: parseFloat(r.val) })));
}

// ─── Correlation Test ────────────────────────────────────────────────────────

async function correlationTest({ tableName, columnA, columnB }) {
  const safeTbl = sanitizeIdentifier(tableName);
  const safeColA = sanitizeIdentifier(columnA);
  const safeColB = sanitizeIdentifier(columnB);

  const [data] = await pool.execute(
    `SELECT CAST(\`${safeColA}\` AS DECIMAL(18,4)) as a, CAST(\`${safeColB}\` AS DECIMAL(18,4)) as b 
     FROM \`${safeTbl}\` WHERE \`${safeColA}\` IS NOT NULL AND \`${safeColB}\` IS NOT NULL LIMIT 50000`
  );

  const pythonCode = `
import sys
import json
import numpy as np
from scipy import stats

with open(sys.argv[1], 'r') as f:
    data = json.load(f)

a = np.array([r['a'] for r in data], dtype=float)
b = np.array([r['b'] for r in data], dtype=float)

pearson_r, pearson_p = stats.pearsonr(a, b)
spearman_r, spearman_p = stats.spearmanr(a, b)

result = {
    "test": "Correlation Analysis",
    "pearson": {"r": round(float(pearson_r), 4), "p_value": round(float(pearson_p), 6), "significant": bool(pearson_p < 0.05)},
    "spearman": {"rho": round(float(spearman_r), 4), "p_value": round(float(spearman_p), 6), "significant": bool(spearman_p < 0.05)},
    "n": len(a),
    "interpretation": "strong" if abs(pearson_r) > 0.7 else "moderate" if abs(pearson_r) > 0.4 else "weak"
}
print(json.dumps(result))
`;

  return await runPythonScript(pythonCode, data.map(r => ({ a: parseFloat(r.a), b: parseFloat(r.b) })));
}

// ─── Normality Test ──────────────────────────────────────────────────────────

async function normalityTest({ tableName, column }) {
  const safeTbl = sanitizeIdentifier(tableName);
  const safeCol = sanitizeIdentifier(column);

  const [data] = await pool.execute(
    `SELECT CAST(\`${safeCol}\` AS DECIMAL(18,4)) as val FROM \`${safeTbl}\` WHERE \`${safeCol}\` IS NOT NULL LIMIT 5000`
  );

  const values = data.map(r => parseFloat(r.val));

  const pythonCode = `
import sys
import json
import numpy as np
from scipy import stats

with open(sys.argv[1], 'r') as f:
    data = json.load(f)

values = np.array(data, dtype=float)

# Shapiro-Wilk (best for n < 5000)
if len(values) <= 5000:
    shapiro_stat, shapiro_p = stats.shapiro(values)
else:
    shapiro_stat, shapiro_p = None, None

# D'Agostino-Pearson
if len(values) >= 20:
    dagostino_stat, dagostino_p = stats.normaltest(values)
else:
    dagostino_stat, dagostino_p = None, None

# Skewness and Kurtosis
skewness = float(stats.skew(values))
kurtosis = float(stats.kurtosis(values))

result = {
    "test": "Normality Tests",
    "n": len(values),
    "shapiro_wilk": {"statistic": round(float(shapiro_stat), 4) if shapiro_stat else None, "p_value": round(float(shapiro_p), 6) if shapiro_p else None, "normal": bool(shapiro_p > 0.05) if shapiro_p else None},
    "dagostino_pearson": {"statistic": round(float(dagostino_stat), 4) if dagostino_stat else None, "p_value": round(float(dagostino_p), 6) if dagostino_p else None, "normal": bool(dagostino_p > 0.05) if dagostino_p else None},
    "skewness": round(skewness, 4),
    "kurtosis": round(kurtosis, 4),
    "interpretation": "normally distributed" if (shapiro_p and shapiro_p > 0.05) else "not normally distributed",
    "descriptive": {"mean": round(float(np.mean(values)), 4), "median": round(float(np.median(values)), 4), "std": round(float(np.std(values)), 4)}
}
print(json.dumps(result))
`;

  return await runPythonScript(pythonCode, values);
}

// ─── Mann-Whitney U Test ─────────────────────────────────────────────────────

async function mannWhitneyTest({ tableName, column, groupColumn, groupA, groupB }) {
  const safeTbl = sanitizeIdentifier(tableName);
  const safeCol = sanitizeIdentifier(column);
  const safeGroup = sanitizeIdentifier(groupColumn);

  const [dataA] = await pool.execute(
    `SELECT CAST(\`${safeCol}\` AS DECIMAL(18,4)) as val FROM \`${safeTbl}\` WHERE \`${safeGroup}\` = ? AND \`${safeCol}\` IS NOT NULL`,
    [groupA]
  );
  const [dataB] = await pool.execute(
    `SELECT CAST(\`${safeCol}\` AS DECIMAL(18,4)) as val FROM \`${safeTbl}\` WHERE \`${safeGroup}\` = ? AND \`${safeCol}\` IS NOT NULL`,
    [groupB]
  );

  const valuesA = dataA.map(r => parseFloat(r.val));
  const valuesB = dataB.map(r => parseFloat(r.val));

  const pythonCode = `
import sys
import json
import numpy as np
from scipy import stats

with open(sys.argv[1], 'r') as f:
    data = json.load(f)

a = np.array(data['a'], dtype=float)
b = np.array(data['b'], dtype=float)

u_stat, p_value = stats.mannwhitneyu(a, b, alternative='two-sided')
# Effect size: rank biserial correlation
r = 1 - (2 * u_stat) / (len(a) * len(b))

result = {
    "test": "Mann-Whitney U Test (Non-parametric)",
    "u_statistic": round(float(u_stat), 4),
    "p_value": round(float(p_value), 6),
    "significant": bool(p_value < 0.05),
    "effect_size_r": round(float(r), 4),
    "group_a": {"name": data['labelA'], "n": len(a), "median": round(float(np.median(a)), 4)},
    "group_b": {"name": data['labelB'], "n": len(b), "median": round(float(np.median(b)), 4)},
    "confidence_level": 0.95
}
print(json.dumps(result))
`;

  return await runPythonScript(pythonCode, { a: valuesA, b: valuesB, labelA: groupA, labelB: groupB });
}

// ─── Auto-detect Best Test ───────────────────────────────────────────────────

export function suggestStatisticalTest(columnTypes, question) {
  const q = question.toLowerCase();

  if (q.includes('normal') || q.includes('distribution') || q.includes('gaussian')) {
    return { test: 'normality', description: 'Shapiro-Wilk & D\'Agostino Normality Test' };
  }
  if (q.includes('correlat') || q.includes('relationship between')) {
    return { test: 'correlation', description: 'Pearson & Spearman Correlation Analysis' };
  }
  if (q.includes('differ') || q.includes('compar') || q.includes('significant')) {
    if (q.includes('group') || q.includes('between')) {
      return { test: 'ttest', description: 'Independent Two-Sample T-Test' };
    }
    return { test: 'ttest', description: 'Two-Sample T-Test' };
  }
  if (q.includes('anova') || q.includes('multiple group') || q.includes('across categories')) {
    return { test: 'anova', description: 'One-Way ANOVA' };
  }
  if (q.includes('chi') || q.includes('categorical') || q.includes('independence')) {
    return { test: 'chi_square', description: 'Chi-Square Test of Independence' };
  }

  return { test: 'normality', description: 'Start with a Normality Test to determine appropriate further analysis' };
}
