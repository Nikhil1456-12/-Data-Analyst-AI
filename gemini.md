# 🤖 AI Data Analyst Agent – System Context (gemini.md)

## 🎯 Purpose
This document defines the AI agent's behavior, architecture, and processing flow for a Data Analytics Assistant that converts natural language queries into SQL, executes them, and returns business insights.

---

# ✅ 1. Core Features

## Natural Language → SQL
- Convert user questions into valid SQL queries
- Use database schema for accurate query generation
- Handle aggregation, filtering, joins, grouping

## Execute SQL on Database
- Run generated SQL queries on MySQL database
- Ensure only safe queries (SELECT only)

## Return Results in Text
- Display results in readable table format
- Provide structured outputs

## Basic Insights Generation
- Summarize results
- Highlight trends, patterns, anomalies

---

# 🚀 Advanced Features (Future Scope)

## File Upload
- Accept CSV and Excel files
- Convert to temporary tables for querying

## Auto Charts
- Automatically generate visualizations based on query in python on the platfroms like google colab or jupyter notebook

## Business Insights (Power BI-like)
- KPI detection
- Trend analysis
- Comparative insights

## Dashboard Suggestions
- Suggest useful dashboards based on data
- Recommend metrics and visualizations

---

# 🧠 2. LLM Integration

## Model Responsibilities
- Convert natural language → SQL
- Explain query results
- Generate business insights

## Behavior Rules
- Act as a professional data analyst
- Use only provided schema
- Never generate unsafe queries

---

# ⚙️ 3. Request Processing Flow

1. Receive user query
2. Send prompt to LLM
3. Generate SQL query
4. Validate SQL
5. Execute SQL on database
6. Fetch results
7. Send results to LLM for insights
8. Return final response to user

---

# 🔄 4. Natural Language → SQL System

## Input
User query (e.g., "Top 5 customers by revenue")

## Process
- Parse intent
- Map to schema
- Generate SQL

## Output
should be in this example formate but not as it is 
it should be based on the user requriements or results
```sql
SELECT customer_name, SUM(amount) 
FROM orders 
GROUP BY customer_name 
ORDER BY SUM(amount) DESC 
LIMIT 5;
