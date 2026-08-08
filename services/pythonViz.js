import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ─── Sandboxed Python Execution ──────────────────────────────────────────────

const PYTHON_TIMEOUT_MS = 30000; // 30 seconds max
const MAX_DATA_SIZE = 5 * 1024 * 1024; // 5MB max data payload

// Dangerous patterns to reject
const BLOCKED_PATTERNS = [
  /import\s+subprocess/i,
  /import\s+shutil/i,
  /import\s+socket/i,
  /import\s+http/i,
  /import\s+urllib/i,
  /import\s+requests/i,
  /os\.system/i,
  /os\.popen/i,
  /os\.exec/i,
  /os\.remove/i,
  /os\.unlink/i,
  /os\.rmdir/i,
  /shutil\./i,
  /eval\s*\(/i,
  /exec\s*\(/i,
  /compile\s*\(/i,
  /__import__/i,
  /open\s*\([^)]*['"][wa]/i, // block file writes
];

function validatePythonCode(code) {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(code)) {
      throw new Error(`Security violation: blocked pattern detected in generated code`);
    }
  }
  return true;
}

export async function runPythonViz(pythonCode, data) {
  // Validate code safety
  validatePythonCode(pythonCode);

  const jsonData = JSON.stringify(data);
  if (jsonData.length > MAX_DATA_SIZE) {
    throw new Error('Data payload too large for visualization. Consider filtering your query.');
  }

  return new Promise((resolve, reject) => {
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `viz_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);

    // Write script to temp file
    fs.writeFileSync(scriptPath, pythonCode, 'utf-8');

    // Write data to separate temp file to avoid argument length limits
    const dataPath = path.join(tempDir, `data_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(dataPath, jsonData, 'utf-8');

    // Modify the script to read from file instead of sys.argv
    const wrappedCode = `
import sys
import json

# Read data from file
with open(r'${dataPath.replace(/\\/g, '\\\\')}', 'r', encoding='utf-8') as f:
    sys.argv = [sys.argv[0], f.read()]

${pythonCode.replace(/json\.loads\(sys\.argv\[1\]\)/g, 'json.loads(sys.argv[1])')}
`;
    fs.writeFileSync(scriptPath, wrappedCode, 'utf-8');

    const pythonProcess = spawn('python', [scriptPath], {
      timeout: PYTHON_TIMEOUT_MS,
      env: {
        ...process.env,
        MPLBACKEND: 'Agg' // Force non-interactive matplotlib backend
      }
    });

    let output = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    pythonProcess.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString();
    });

    const timeout = setTimeout(() => {
      pythonProcess.kill('SIGTERM');
      cleanup();
      reject(new Error('Python visualization timed out after 30 seconds'));
    }, PYTHON_TIMEOUT_MS);

    function cleanup() {
      try { fs.unlinkSync(scriptPath); } catch (e) { /* ignore */ }
      try { fs.unlinkSync(dataPath); } catch (e) { /* ignore */ }
    }

    pythonProcess.on('close', (code) => {
      clearTimeout(timeout);
      cleanup();

      if (code !== 0) {
        console.error('[PythonViz] Error output:', errorOutput.slice(0, 500));
        reject(new Error(`Visualization generation failed (exit code ${code})`));
        return;
      }

      const base64Image = output.trim();
      if (!base64Image || base64Image.length < 100) {
        resolve(null);
      } else {
        resolve(`data:image/png;base64,${base64Image}`);
      }
    });

    pythonProcess.on('error', (err) => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error(`Failed to spawn Python process: ${err.message}`));
    });
  });
}

// ─── Generic Python Script Execution (for stats/forecasting) ─────────────────

export async function runPythonScript(pythonCode, inputData) {
  validatePythonCode(pythonCode);

  const jsonData = JSON.stringify(inputData);

  return new Promise((resolve, reject) => {
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `script_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
    const dataPath = path.join(tempDir, `input_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);

    fs.writeFileSync(dataPath, jsonData, 'utf-8');
    fs.writeFileSync(scriptPath, pythonCode, 'utf-8');

    const pythonProcess = spawn('python', [scriptPath, dataPath], {
      timeout: PYTHON_TIMEOUT_MS,
      env: { ...process.env, MPLBACKEND: 'Agg' }
    });

    let output = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (chunk) => { output += chunk.toString(); });
    pythonProcess.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });

    const timeout = setTimeout(() => {
      pythonProcess.kill('SIGTERM');
      cleanup();
      reject(new Error('Python script timed out'));
    }, PYTHON_TIMEOUT_MS);

    function cleanup() {
      try { fs.unlinkSync(scriptPath); } catch (e) { /* ignore */ }
      try { fs.unlinkSync(dataPath); } catch (e) { /* ignore */ }
    }

    pythonProcess.on('close', (code) => {
      clearTimeout(timeout);
      cleanup();

      if (code !== 0) {
        reject(new Error(`Script failed: ${errorOutput.slice(0, 300)}`));
        return;
      }

      try {
        const result = JSON.parse(output.trim());
        resolve(result);
      } catch (e) {
        resolve({ raw: output.trim() });
      }
    });

    pythonProcess.on('error', (err) => {
      clearTimeout(timeout);
      cleanup();
      reject(err);
    });
  });
}
