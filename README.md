# Data Analyst AI — v2.0

Professional AI-powered data analysis platform. Upload datasets, ask natural language questions, and get instant SQL queries, business insights, visualizations, statistical tests, and forecasts.

## Features

- **NL-to-SQL** — Ask questions in plain English, get accurate MySQL queries with multi-table JOIN support
- **Automated EDA** — Full data profiling on upload: type inference, null analysis, distributions, anomaly detection
- **Data Cleaning** — Natural language cleaning operations: remove nulls, fill values, deduplicate, cast types
- **Statistical Testing** — T-test, ANOVA, Chi-Square, Correlation, Normality, Mann-Whitney with plain-English interpretation
- **Time-Series Forecasting** — Auto-detect time columns, forecast with Holt-Winters/exponential smoothing
- **Feature Importance** — Random Forest-based feature ranking for predictive insights
- **PDF Report Export** — Generate professional reports with insights, charts, tables, and SQL
- **Visualization Engine** — Auto-generated matplotlib/seaborn charts (sandboxed Python execution)
- **Relationship Detection** — Automatically identifies FK patterns and shared columns across tables
- **Authentication** — JWT-based auth with optional enable/disable toggle
- **Rate Limiting** — Configurable request throttling per endpoint type
- **Query History** — Full audit log with re-run capability

## Tech Stack

**Backend:** Node.js, Express, MySQL2, OpenAI/Groq SDK, PDFKit  
**Frontend:** React 18, Vite  
**Analytics:** Python (pandas, scipy, scikit-learn, statsmodels, matplotlib, seaborn)  
**Security:** Helmet, JWT, bcrypt, rate limiting, sandboxed code execution

## Quick Start

```bash
# 1. Clone and install
npm install
cd client && npm install && cd ..

# 2. Configure environment
cp .env.example .env
# Edit .env with your GROQ_API_KEY and MySQL credentials

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Start development
npm run dev          # Backend on :3001
cd client && npm run dev  # Frontend on :5173

# Or build for production
npm run build && npm start
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/query/stream` | SSE streaming NL-to-SQL pipeline |
| POST | `/api/query/clean` | Execute data cleaning operations |
| POST | `/api/upload` | Upload CSV/Excel/JSON/PDF files |
| GET | `/api/profile/:table` | Full data profile for a table |
| GET | `/api/profile/:table/correlation` | Correlation matrix |
| GET | `/api/profile/:table/outliers/:col` | Outlier detection |
| POST | `/api/statistics/test` | Run statistical hypothesis tests |
| POST | `/api/forecast/generate` | Generate time-series forecasts |
| POST | `/api/forecast/feature-importance` | Feature importance ranking |
| POST | `/api/report/generate` | Generate PDF report |
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login |

## Deployment

### Docker
```bash
docker build -t data-analyst-ai .
docker run -p 3001:3001 --env-file .env data-analyst-ai
```

### Render.com
Push to a connected repo — auto-deploys using `render.yaml`.

## License

MIT
