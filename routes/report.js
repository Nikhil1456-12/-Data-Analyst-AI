import { Router } from 'express';
import { generatePDFReport, buildReportSections } from '../services/reportExport.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// POST /api/report/generate — Generate PDF report
router.post('/generate', optionalAuth, async (req, res) => {
  try {
    const { title, subtitle, analysisResult, sections: customSections } = req.body;

    let sections;
    if (customSections && customSections.length > 0) {
      sections = customSections;
    } else if (analysisResult) {
      sections = buildReportSections(analysisResult);
    } else {
      return res.status(400).json({ error: 'Either analysisResult or sections array is required' });
    }

    const pdfBuffer = await generatePDFReport({
      title: title || 'Data Analysis Report',
      subtitle: subtitle || '',
      generatedAt: new Date().toISOString(),
      sections
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report_${Date.now()}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('[Report] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
