import PDFDocument from 'pdfkit';

// ─── PDF Report Generation ───────────────────────────────────────────────────

/**
 * Generates a professional PDF report from analysis results.
 * Returns a Buffer containing the PDF.
 */
export async function generatePDFReport(reportData) {
  const {
    title = 'Data Analysis Report',
    subtitle = '',
    generatedAt = new Date().toISOString(),
    sections = []
  } = reportData;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 60, bottom: 60, left: 50, right: 50 },
        info: {
          Title: title,
          Author: 'Data Analyst AI',
          Creator: 'Data Analyst AI Platform v2.0'
        }
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // ─── Header ─────────────────────────────────────────────────
      doc.rect(0, 0, doc.page.width, 100).fill('#1a1a2e');
      doc.fill('#ffffff')
        .fontSize(24)
        .font('Helvetica-Bold')
        .text(title, 50, 30, { width: doc.page.width - 100 });

      if (subtitle) {
        doc.fontSize(12)
          .font('Helvetica')
          .fill('#a0a0cc')
          .text(subtitle, 50, 60);
      }

      doc.fill('#808090')
        .fontSize(9)
        .text(`Generated: ${new Date(generatedAt).toLocaleString()}`, 50, 78);

      doc.moveDown(4);
      doc.y = 120;

      // ─── Sections ───────────────────────────────────────────────
      for (const section of sections) {
        // Check if we need a new page
        if (doc.y > doc.page.height - 150) {
          doc.addPage();
          doc.y = 60;
        }

        switch (section.type) {
          case 'heading':
            renderHeading(doc, section);
            break;
          case 'text':
            renderText(doc, section);
            break;
          case 'insights':
            renderInsights(doc, section);
            break;
          case 'table':
            renderTable(doc, section);
            break;
          case 'stats':
            renderStats(doc, section);
            break;
          case 'sql':
            renderSQL(doc, section);
            break;
          case 'divider':
            renderDivider(doc);
            break;
          default:
            break;
        }
      }

      // ─── Footer ─────────────────────────────────────────────────
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fill('#808090')
          .fontSize(8)
          .text(
            `Data Analyst AI | Page ${i + 1} of ${pageCount}`,
            50,
            doc.page.height - 40,
            { align: 'center', width: doc.page.width - 100 }
          );
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// ─── Section Renderers ───────────────────────────────────────────────────────

function renderHeading(doc, section) {
  doc.moveDown(0.5);
  doc.fill('#1a1a2e')
    .fontSize(16)
    .font('Helvetica-Bold')
    .text(section.content || section.text, { underline: false });
  doc.moveDown(0.3);

  // Accent line
  doc.moveTo(50, doc.y)
    .lineTo(200, doc.y)
    .strokeColor('#4361ee')
    .lineWidth(2)
    .stroke();
  doc.moveDown(0.5);
}

function renderText(doc, section) {
  doc.fill('#333333')
    .fontSize(10)
    .font('Helvetica')
    .text(section.content || section.text, {
      width: doc.page.width - 100,
      lineGap: 3
    });
  doc.moveDown(0.5);
}

function renderInsights(doc, section) {
  const insights = section.content || section.text || '';
  const lines = insights.split('\n').filter(l => l.trim());

  doc.fill('#1a1a2e')
    .fontSize(12)
    .font('Helvetica-Bold')
    .text('Key Insights', { underline: false });
  doc.moveDown(0.3);

  for (const line of lines) {
    if (doc.y > doc.page.height - 80) {
      doc.addPage();
      doc.y = 60;
    }

    doc.fill('#444444')
      .fontSize(10)
      .font('Helvetica')
      .text(line.trim(), 65, doc.y, {
        width: doc.page.width - 130,
        lineGap: 2
      });
    doc.moveDown(0.3);
  }
  doc.moveDown(0.5);
}

function renderTable(doc, section) {
  const { headers = [], rows = [], maxRows = 20 } = section;

  if (headers.length === 0 || rows.length === 0) return;

  const displayRows = rows.slice(0, maxRows);
  const colWidth = Math.min(120, (doc.page.width - 100) / headers.length);
  const startX = 50;

  // Table header
  doc.fill('#1a1a2e').fontSize(8).font('Helvetica-Bold');
  headers.forEach((h, i) => {
    doc.text(String(h).slice(0, 15), startX + i * colWidth, doc.y, { width: colWidth, continued: i < headers.length - 1 });
  });
  doc.moveDown(0.2);

  // Header line
  doc.moveTo(startX, doc.y).lineTo(startX + headers.length * colWidth, doc.y).strokeColor('#cccccc').lineWidth(0.5).stroke();
  doc.moveDown(0.3);

  // Table rows
  doc.fill('#444444').fontSize(8).font('Helvetica');
  for (const row of displayRows) {
    if (doc.y > doc.page.height - 80) {
      doc.addPage();
      doc.y = 60;
    }

    headers.forEach((h, i) => {
      const val = row[h] !== null && row[h] !== undefined ? String(row[h]).slice(0, 18) : '—';
      doc.text(val, startX + i * colWidth, doc.y, { width: colWidth, continued: i < headers.length - 1 });
    });
    doc.moveDown(0.2);
  }

  if (rows.length > maxRows) {
    doc.moveDown(0.2);
    doc.fill('#808090').fontSize(8).text(`... and ${rows.length - maxRows} more rows`);
  }
  doc.moveDown(0.5);
}

function renderStats(doc, section) {
  const stats = section.data || {};
  doc.fill('#1a1a2e').fontSize(11).font('Helvetica-Bold').text(section.title || 'Statistics');
  doc.moveDown(0.3);

  for (const [key, value] of Object.entries(stats)) {
    doc.fill('#555555').fontSize(9).font('Helvetica')
      .text(`${key}: `, { continued: true })
      .font('Helvetica-Bold')
      .text(String(value));
  }
  doc.moveDown(0.5);
}

function renderSQL(doc, section) {
  const sql = section.content || section.text || '';

  doc.fill('#1a1a2e').fontSize(10).font('Helvetica-Bold').text('Generated SQL');
  doc.moveDown(0.2);

  // SQL code block background
  const codeY = doc.y;
  const codeHeight = Math.min(100, sql.length * 0.3 + 30);
  doc.rect(50, codeY, doc.page.width - 100, codeHeight).fill('#f5f5f5');

  doc.fill('#333333')
    .fontSize(8)
    .font('Courier')
    .text(sql, 60, codeY + 10, {
      width: doc.page.width - 120
    });
  doc.y = codeY + codeHeight + 10;
  doc.moveDown(0.5);
}

function renderDivider(doc) {
  doc.moveDown(0.3);
  doc.moveTo(50, doc.y)
    .lineTo(doc.page.width - 50, doc.y)
    .strokeColor('#e0e0e0')
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.5);
}

// ─── Report Builder Helper ───────────────────────────────────────────────────

export function buildReportSections(analysisResult) {
  const sections = [];

  if (analysisResult.sql) {
    sections.push({ type: 'heading', content: 'Query Analysis' });
    sections.push({ type: 'sql', content: analysisResult.sql });
    sections.push({ type: 'divider' });
  }

  if (analysisResult.insights) {
    sections.push({ type: 'insights', content: analysisResult.insights });
    sections.push({ type: 'divider' });
  }

  if (analysisResult.data && analysisResult.data.length > 0) {
    sections.push({ type: 'heading', content: 'Results Data' });
    sections.push({
      type: 'table',
      headers: Object.keys(analysisResult.data[0]),
      rows: analysisResult.data,
      maxRows: 30
    });
    sections.push({ type: 'divider' });
  }

  if (analysisResult.statistics) {
    sections.push({ type: 'heading', content: 'Statistical Analysis' });
    sections.push({ type: 'stats', title: analysisResult.statistics.test || 'Test Results', data: analysisResult.statistics });
    sections.push({ type: 'divider' });
  }

  if (analysisResult.forecast) {
    sections.push({ type: 'heading', content: 'Forecast Results' });
    sections.push({ type: 'stats', title: 'Forecast Summary', data: analysisResult.forecast.summary || {} });
  }

  if (analysisResult.executiveSummary) {
    sections.push({ type: 'heading', content: 'Executive Summary' });
    sections.push({ type: 'text', content: analysisResult.executiveSummary });
  }

  return sections;
}
