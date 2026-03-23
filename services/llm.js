import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import { getDatabaseSchema } from './db.js';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

export async function processNLQuery(nlQuery) {
  const schema = await getDatabaseSchema();

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

export async function generateSuggestions(history = []) {
  const schema = await getDatabaseSchema();
  if (!schema || schema.length < 5) return [];

  const historyStr = history.length > 0 ? `DO NOT SUGGEST ANY OF THESE PREVIOUS QUERIES:\n- ${history.join('\n- ')}` : '';

  const prompt = `You are an expert AI Data Analyst. Analyze the exact database schema below and provide exactly 4 highly-specific, pinpoint questions the user could ask to get powerful business insights.

Schema context:
${schema}

${historyStr}

CRITICAL RULES:
- The questions MUST be perfectly solvable using ONLY the exact tables and columns provided. 
- Use specific column names in your questions if it adds clarity.
- Ensure the agent can actually convert these into valid SQL.
- Provide exactly 4 distinct natural language questions.

Output must be a plain JSON array of strings ONLY. Example:
["What is the average transaction_amount per month in the sales table?", "Which customer_id has the highest order_count?"]`;

  try {
    const response = await openai.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8, // higher temp for variation
    });

    let rawList = response.choices[0].message.content.trim();
    if (rawList.startsWith('```json')) rawList = rawList.slice(7);
    if (rawList.endsWith('```')) rawList = rawList.slice(0, -3);
    
    return JSON.parse(rawList.trim());
  } catch(e) {
    console.error("Suggestions generator error:", e);
    return [];
  }
}
