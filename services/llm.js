import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import { getDatabaseSchema, detectRelationships } from './db.js';

dotenv.config();

// ─── LLM Client Setup ────────────────────────────────────────────────────────

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || 'missing_api_key',
  baseURL: process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1',
});

const MODEL = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';

async function llmCall(messages, temperature = 0, maxTokens = 4096) {
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages,
    temperature,
    max_tokens: maxTokens
  });
  return response.choices[0].message.content.trim();
}

function stripMarkdown(text) {
  return text.replace(/^```(sql|python|json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

// ─── NL to SQL Conversion ────────────────────────────────────────────────────

export async function processNLQuery(nlQuery, activeTable = null) {
  let schema = await getDatabaseSchema();
  const relationships = await detectRelationships();

  let context = schema;
  if (activeTable) {
    context = `PRIMARY FOCUS TABLE: ${activeTable}\n\n${schema}`;
  }

  let relationshipContext = '';
  if (relationships.length > 0) {
    relationshipContext = '\nDETECTED TABLE RELATIONSHIPS:\n' +
      relationships.map(r => `  ${r.tableA}.${r.joinColumn} ↔ ${r.tableB}.${r.joinColumn} (confidence: ${r.confidence})`).join('\n');
  }

  const prompt = `You are an expert Data Analyst and MySQL developer.
Convert the user's natural language request into a valid MySQL query.

DATABASE SCHEMA:
${context}
${relationshipContext}

CRITICAL RULES:
1. Return ONLY the raw SQL query — no markdown, no explanations, no comments.
2. Use proper JOINs when the query requires data from multiple tables. Refer to the DETECTED TABLE RELATIONSHIPS above.
3. For DELETE/DROP operations: generate accurate DELETE or DROP TABLE queries.
4. For duplicate removal: use the \`__row_id\` column as the tie-breaker.
5. For null removal: construct DELETE checking all relevant columns for IS NULL.
6. MySQL does NOT support PERCENTILE_CONT, PERCENTILE_DISC, MEDIAN(), or WITHIN GROUP. Use subqueries or AVG instead.
7. Always use backticks for table and column identifiers.
8. For data cleaning requests (fill nulls, cast types, rename columns): generate appropriate UPDATE/ALTER statements.
9. Limit results to 1000 rows unless the user explicitly asks for all.

User Request: ${nlQuery}`;

  let sql = await llmCall([{ role: 'user', content: prompt }], 0);
  sql = stripMarkdown(sql);
  return sql;
}

// ─── Business Insights Generation ────────────────────────────────────────────

export async function generateInsights(nlQuery, data) {
  let dataStr = JSON.stringify(data);
  if (dataStr.length > 8000) {
    dataStr = dataStr.slice(0, 8000) + '... (truncated)';
  }

  const prompt = `You are a Senior Data Analyst at a Fortune 500 company. Analyze the query results and produce actionable business insights.

User Query: "${nlQuery}"
Data Results (${data.length} rows): ${dataStr}

Provide exactly 4-6 insights in this format:
- Start each insight with an emoji indicator (📈 for growth, 📉 for decline, ⚠️ for warning, ✅ for positive, 🔍 for observation)
- Each insight should be 1-2 sentences maximum
- Focus on: trends, anomalies, business implications, and recommended actions
- Be specific with numbers and percentages where possible

Do NOT use markdown headers. Use plain bullet points only.`;

  return await llmCall([{ role: 'user', content: prompt }], 0.3);
}

// ─── Python Visualization Code Generation ────────────────────────────────────

export async function generatePythonVizCode(nlQuery, data) {
  if (!data || data.length === 0) return null;

  const keys = Object.keys(data[0]);
  const sampleRow = data[0];

  const prompt = `You are an expert Data Visualization engineer. Write a Python script to create a professional, publication-quality chart.

User Query: "${nlQuery}"
Available Columns: ${JSON.stringify(keys)}
Sample Row: ${JSON.stringify(sampleRow)}
Total Rows: ${data.length}

REQUIREMENTS:
- Data is passed as JSON string via sys.argv[1]. Parse with json.loads(sys.argv[1]).
- Use pandas, matplotlib, and seaborn.
- Apply: sns.set_theme(style="darkgrid", palette="husl")
- Use a modern color palette with plt.cm.Set2 or similar.
- Figure size: (12, 7) with tight_layout.
- Professional title, axis labels with proper formatting.
- Rotate x-labels if needed for readability.
- Add subtle gridlines and remove top/right spines.
- DO NOT use plt.show().
- Save to BytesIO, print base64 encoded PNG string only.
- Wrap in try/except — on error print nothing.
- Choose the BEST chart type based on data: bar, line, scatter, heatmap, pie, box, etc.
- If dates detected, use time-series line chart.

Return ONLY raw Python code — no markdown.`;

  let code = await llmCall([{ role: 'user', content: prompt }], 0);
  code = stripMarkdown(code);
  return code;
}

// ─── Smart Suggestions ───────────────────────────────────────────────────────

export async function generateSuggestions(history = [], activeTable = null) {
  let schema = await getDatabaseSchema();
  if (!schema || schema.length < 5) {
    return [
      "Upload a dataset to get started with AI-powered analysis",
      "How do I perform a Cohort Analysis or calculate Customer Retention Rate?",
      "Analyze distributions and identify statistical outliers in my data",
      "Generate a Month-over-Month growth rate report for key metrics"
    ];
  }

  if (activeTable) {
    const focusLines = schema.split('\n').filter(l => l.includes(`Table: ${activeTable}`));
    schema = `ACTIVE TABLE FOCUS:\n${focusLines.join('\n')}\n\nFull Schema:\n${schema}`;
  }

  const historyStr = history.length > 0
    ? `\nPREVIOUS QUERIES (do NOT repeat):\n- ${history.slice(-10).join('\n- ')}`
    : '';

  const prompt = `You are a Senior Data Scientist. Based on the database schema, generate exactly 4 sophisticated analytical questions.

Schema:
${schema}
${historyStr}

RULES:
1. Questions must be solvable using ONLY the tables/columns in the schema.
2. Focus on advanced analytics: trend analysis, anomaly detection, cohort analysis, statistical distributions, segment analysis, data quality checks.
3. Refer to specific table and column names.
4. Questions should be natural language (as a human analyst would ask).
5. Return a JSON array of exactly 4 strings. No markdown, no explanations.

Example: ["What is the week-over-week trend in order_amount?", ...]`;

  try {
    let raw = await llmCall([{ role: 'user', content: prompt }], 0.7);
    raw = stripMarkdown(raw);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, 4);
    }
    throw new Error('Invalid format');
  } catch (e) {
    const tablePart = activeTable ? `in \`${activeTable}\`` : 'across available tables';
    return [
      `Analyze the distribution of numeric columns ${tablePart}`,
      `Identify potential outliers or anomalies ${tablePart}`,
      `Show month-over-month trends ${tablePart}`,
      `Find columns with highest null rates ${tablePart}`
    ];
  }
}

// ─── Data Cleaning Query Generation ──────────────────────────────────────────

export async function generateCleaningQuery(instruction, tableName, schema) {
  const prompt = `You are an expert Data Engineer. Generate a MySQL query to clean/transform data as requested.

Table: ${tableName}
Schema: ${schema}

Cleaning Instruction: "${instruction}"

RULES:
1. Return ONLY the raw SQL — no markdown, no explanations.
2. Supported operations: remove nulls, fill nulls (with mean/median/mode/specific value), remove duplicates, cast types, trim whitespace, standardize formats.
3. Use UPDATE, DELETE, or ALTER TABLE as appropriate.
4. For filling with mean/median: use a subquery to calculate the value.
5. Always reference the \`__row_id\` column for deduplication.

SQL:`;

  let sql = await llmCall([{ role: 'user', content: prompt }], 0);
  return stripMarkdown(sql);
}

// ─── Statistical Analysis Prompt ─────────────────────────────────────────────

export async function generateStatisticalAnalysis(query, data, testType) {
  const dataStr = JSON.stringify(data).slice(0, 5000);

  const prompt = `You are a Statistician. Interpret the following statistical test results and provide a clear, professional explanation.

User Question: "${query}"
Test Performed: ${testType}
Results Data: ${dataStr}

Provide:
1. A one-line summary of the finding (with statistical significance noted)
2. Plain English interpretation (what does this mean for the business?)
3. Confidence level and practical significance
4. Recommendation based on the finding

Format as clean bullet points. No markdown headers.`;

  return await llmCall([{ role: 'user', content: prompt }], 0.3);
}

// ─── Forecasting Interpretation ──────────────────────────────────────────────

export async function interpretForecast(query, forecastData) {
  const dataStr = JSON.stringify(forecastData).slice(0, 5000);

  const prompt = `You are a Business Forecasting Analyst. Interpret the following time-series forecast results.

User Question: "${query}"
Forecast Results: ${dataStr}

Provide:
1. Summary of the forecast direction (growth/decline/stable) with specific numbers
2. Key inflection points or trend changes
3. Confidence assessment (how reliable is this forecast?)
4. Business recommendation based on the forecast

Format as clean bullet points. Be concise and specific with numbers.`;

  return await llmCall([{ role: 'user', content: prompt }], 0.3);
}

// ─── PDF Table Extraction ────────────────────────────────────────────────────

export async function parsePDFTableToJSON(rawText) {
  if (!rawText) return [];
  if (rawText.length > 30000) {
    rawText = rawText.slice(0, 30000) + '... (truncated)';
  }

  const prompt = `You are an expert Data Engineer. Extract tabular data from the following PDF text and return it as a JSON array of objects.

RULES:
1. Return ONLY a valid JSON array. No markdown, no explanations.
2. Use snake_case for column keys.
3. Every object must have identical keys.
4. If multiple tables exist, pick the most prominent one.
5. If no tabular data found, return [].

PDF Text:
${rawText}`;

  try {
    let raw = await llmCall([{ role: 'user', content: prompt }], 0);
    raw = stripMarkdown(raw);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('[LLM] PDF parse error:', e.message);
    return [];
  }
}

// ─── NL to Regex (Data Extraction) ──────────────────────────────────────────

export async function generateRegexExtraction(instruction, columnName, sampleValues) {
  const prompt = `You are a regex expert. Generate a MySQL-compatible REGEXP pattern to extract data as described.

Column: ${columnName}
Sample values: ${JSON.stringify(sampleValues.slice(0, 5))}
Extraction instruction: "${instruction}"

Return ONLY the MySQL SELECT query that uses REGEXP or REGEXP_SUBSTR to extract the requested data. No markdown.`;

  let sql = await llmCall([{ role: 'user', content: prompt }], 0);
  return stripMarkdown(sql);
}

// ─── Stakeholder Summary Generation ──────────────────────────────────────────

export async function generateExecutiveSummary(nlQuery, data, insights) {
  const dataStr = JSON.stringify(data).slice(0, 3000);

  const prompt = `You are a Business Intelligence Director presenting to C-suite executives. Create a brief, non-technical executive summary.

Analysis Question: "${nlQuery}"
Key Data Points: ${dataStr}
Technical Insights: ${insights}

Write a 3-4 sentence executive summary that:
1. States the key finding in business terms (no technical jargon)
2. Quantifies the impact where possible
3. Ends with a clear recommended action

Write in a confident, professional tone. No bullet points — flowing prose only.`;

  return await llmCall([{ role: 'user', content: prompt }], 0.3);
}
