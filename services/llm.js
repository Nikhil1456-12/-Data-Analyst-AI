import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import { getDatabaseSchema } from './db.js';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || 'missing_api_key',
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function processNLQuery(nlQuery, activeTable = null) {
  let schema = await getDatabaseSchema();
  if (activeTable) {
      schema = `FOCUS EXCLUSIVELY ON THIS TABLE:\n` + schema.split('\n').filter(l => l.includes(`Table: ${activeTable}`)).join('\n') + `\n\nFull Schema Context:\n${schema}`;
  }

  const prompt = `You are an expert Data Analyst and MySQL developer.
Given the user's natural language request, convert it to a valid MySQL query based on the following schema:
${schema}

CRITICAL RULES:
1. Return ONLY the raw SQL query, without any markdown formatting or explanations.
2. If the user asks to remove, delete, or drop things: Generate the accurate \`DELETE\` or \`DROP TABLE\` query.
3. If they ask to remove "duplicates", construct a query that deletes duplicate rows while keeping the original. Use the auto-generated \`__internal_id\` column as the tie-breaker for deleting duplicates.
4. If they ask to remove "nulls", construct a \`DELETE\` query checking all relevant columns for \`IS NULL\`.

User Request: ${nlQuery}`;

  const response = await openai.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
  });

  let sql = response.choices[0].message.content.trim();
  // Remove markdown formatting if the model still adds it
  sql = sql.replace(/^```sql\n/, '').replace(/```$/, '').trim();
  return sql;
}

export async function generateInsights(nlQuery, data) {
    let dataStr = JSON.stringify(data);
    // limit data context length to avoid huge token usage
    if (dataStr.length > 5000) {
        dataStr = dataStr.slice(0, 5000) + "... (truncated)";
    }

    const prompt = `You are an expert Data Analyst. Produce 3-5 key business insights from the provided SQL query results.
User Query: ${nlQuery}
Data Results: ${dataStr}

Provide clear, bulleted insights identifying trends, totals, or anomalies. Be concise.`;

    const response = await openai.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
    });
  
    return response.choices[0].message.content.trim();
}

export async function generatePythonVizCode(nlQuery, data) {
    if (!data || data.length === 0) return null;

    const keys = Object.keys(data[0]);

    const prompt = `You are an expert Data Scientist and Python visualization expert. Write a Python script using pandas, matplotlib, and seaborn to create a professional, stunning chart based on the user's query.
User Query: "${nlQuery}"
Available Columns: ${JSON.stringify(keys)}

Requirements:
- The data array will be passed in as a JSON string to sys.argv[1].
- Use pandas to load this JSON data.
- Analyze the Data and determine distinct X and Y axes appropriately. Use Time series formats for dates if applicable.
- Make it extremely professional using seaborn styles (sns.set_theme(style="whitegrid")).
- Use distinct, modern colors and highly legible rotated tick labels if needed. Add a professional Title.
- DO NOT Use plt.show(). 
- Save the plot to a BytesIO object and print the base64 encoded string of the image.
- DO NOT print anything else except the final base64 string.
- Return ONLY the raw Python code without any markdown tags.

Example structure:
import sys
import json
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import io
import base64

try:
    sns.set_theme(style="whitegrid")
    data = json.loads(sys.argv[1])
    df = pd.DataFrame(data)
    
    plt.figure(figsize=(10,6))
    # ... smart dynamic plot logic using distinct X and Y based on data types ...
    
    img = io.BytesIO()
    plt.savefig(img, format='png', bbox_inches='tight')
    img.seek(0)
    print(base64.b64encode(img.read()).decode('utf-8'))
except Exception as e:
    pass
`;

    const response = await openai.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
    });

    let pythonCode = response.choices[0].message.content.trim();
    pythonCode = pythonCode.replace(/^```python\n/, '').replace(/```$/, '').trim();
    return pythonCode;
}

export async function generateSuggestions(history = [], activeTable = null) {
  let schema = await getDatabaseSchema();
  if (!schema || schema.length < 5) {
    return [
      "How do I perform a Cohort Analysis or calculate Customer Retention Rate?",
      "Analyze the distribution of sales/transactions to identify outliers using SQL.",
      "Generate a Month-over-Month (MoM) growth rate report for key business metrics.",
      "How do I run a Pareto (80/20 rule) analysis to find my top products or customers?"
    ];
  }

  if (activeTable) {
      schema = `FOCUS EXCLUSIVELY ON THIS TABLE:\n` + schema.split('\n').filter(l => l.includes(`Table: ${activeTable}`)).join('\n');
  }

  const historyStr = history.length > 0 ? `DO NOT SUGGEST ANY OF THESE PREVIOUS QUERIES:\n- ${history.join('\n- ')}` : '';

  const prompt = `You are a Senior AI Data Scientist and expert Data Analyst.
Analyze the exact database schema below and provide exactly 4 highly-specific, sophisticated, and analytical questions that a professional data analyst or data science worker would ask to get deep, actionable business insights or perform advanced data analysis on this dataset.

Schema context:
${schema}

${historyStr}

CRITICAL RULES FOR GENERATION:
1. The questions MUST be perfectly solvable using ONLY the exact tables and columns provided in the schema context.
2. The questions must be geared towards professional data analysis and data science. They should include combinations of the following analytical patterns:
   - Trend & Time-Series Analysis (e.g., month-over-month growth, weekly trends, seasonal patterns, peak times/dates).
   - Cohort & Retention Analysis (e.g., tracking customer groups over time, calculating retention rates).
   - Anomaly & Outlier Detection (e.g., identifying transactions/records that deviate significantly from the average, finding extreme values).
   - Segment & Pareto (80/20) Analysis (e.g., identifying the top 20% of segments contributing to 80% of metrics, profiling customer segments).
   - Statistical & Distribution Insights (e.g., finding the average, median, distribution range, or frequency of specific behaviors).
   - Data Quality & Cleaning (e.g., identifying high null-rate columns, analyzing duplicate distributions).
3. Do NOT suggest basic or trivial queries like "Select all columns from table" or "List all rows".
4. Refer to specific table and column names from the schema to make the questions highly relevant and immediately executable.
5. Provide exactly 4 distinct, highly professional, and natural language questions.

Output must be a plain JSON array of strings ONLY. Do not include any explanations, markdown blockquotes, or extra text.
Example format:
[
  "What is the Month-over-Month growth rate of sales in the transactions table?",
  "Identify any transactions where the amount is 3 standard deviations above the average in the payments table.",
  "Which 20% of customer segments generate 80% of total revenue in the orders table?",
  "What is the distribution of active days for users grouped by registration cohort?"
]`;

  try {
    const response = await openai.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.75,
    });

    let rawList = response.choices[0].message.content.trim();
    // Strip markdown formatting if any
    rawList = rawList.replace(/^```(json)?\s*/i, '').replace(/\s*```$/, '').trim();
    
    const parsed = JSON.parse(rawList);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, 4);
    }
    throw new Error("Parsed content is not a non-empty array");
  } catch(e) {
    console.error("Suggestions generator error:", e);
    const tablePart = activeTable ? `in \`${activeTable}\`` : 'in the active table';
    return [
      `Analyze the weekly trend of records ${tablePart}.`,
      `Identify duplicate records or rows with high missing value counts ${tablePart}.`,
      `Find the maximum, minimum, and average range distributions ${tablePart}.`,
      `Analyze potential data quality anomalies or outliers ${tablePart}.`
    ];
  }
}

export async function parsePDFTableToJSON(rawText) {
  if (!rawText) return [];
  // Truncate to avoid context limit issues
  if (rawText.length > 30000) {
      rawText = rawText.slice(0, 30000) + "... (truncated)";
  }

  const prompt = `You are an expert Data Engineer. I have extracted raw text from a PDF document that contains tabular data.
Because of the extraction process, the rows and columns might be messy, misaligned, or combined.

Your task is to analyze the text, identify the underlying table structure, and reconstruct it into a perfectly formatted JSON array of objects.

CRITICAL RULES:
1. Return ONLY a valid JSON array of objects. Do NOT wrap it in markdown block quotes or include any explanatory text.
2. The keys of each object should represent the column headers (use snake_case for keys).
3. Every object in the array MUST have the exact same keys.
4. If there are multiple tables, merge them or pick the most prominent data table.
5. If no table data can be found, return an empty array [].

Extracted PDF Text:
${rawText}
`;

  try {
    const response = await openai.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    });

    let rawList = response.choices[0].message.content.trim();
    if (rawList.startsWith('\`\`\`json')) rawList = rawList.slice(7);
    if (rawList.startsWith('\`\`\`')) rawList = rawList.slice(3);
    if (rawList.endsWith('\`\`\`')) rawList = rawList.slice(0, -3);
    
    const parsed = JSON.parse(rawList.trim());
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    console.error("PDF Table to JSON error:", e);
    return [];
  }
}
