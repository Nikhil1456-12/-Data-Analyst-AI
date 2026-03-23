import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export async function runPythonViz(pythonCode, data) {
  return new Promise((resolve, reject) => {
    // Write python code to a temporary file
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `viz_${Date.now()}.py`);
    fs.writeFileSync(scriptPath, pythonCode);

    const jsonData = JSON.stringify(data);

    const pythonProcess = spawn('python', [scriptPath, jsonData]);

    let output = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    pythonProcess.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString();
    });

    pythonProcess.on('close', (code) => {
      // Clean up the temp file
      try {
        fs.unlinkSync(scriptPath);
      } catch (e) {
        console.error("Could not cleanup temp python file", e);
      }

      if (code !== 0) {
        reject(new Error(`Python process exited with code ${code}: ${errorOutput}`));
        return;
      }

      // The python script should print ONLY the base64 string
      const base64Image = output.trim();
      if (!base64Image) {
        resolve(null);
      } else {
        // Return Data URL for frontend
        resolve(`data:image/png;base64,${base64Image}`);
      }
    });
  });
}
