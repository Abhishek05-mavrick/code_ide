// server.js
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// Create a temporary directory for code files
const TEMP_DIR = path.join(__dirname, 'temp');

// Initialize temp directory
async function initializeTempDirectory() {
    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
        console.log('Temporary directory created successfully');
    } catch (error) {
        console.error('Error creating temporary directory:', error);
    }
}
initializeTempDirectory();

// Safe file deletion utility
async function safeDeleteFile(filePath) {
    try {
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        if (exists) {
            await fs.unlink(filePath);
        }
    } catch (error) {
        console.error(`Error deleting file ${filePath}:`, error);
    }
}

// Clean up old files periodically
const cleanup = async () => {
    try {
        const files = await fs.readdir(TEMP_DIR);
        for (const file of files) {
            await safeDeleteFile(path.join(TEMP_DIR, file));
        }
    } catch (error) {
        console.error('Cleanup error:', error);
    }
};
setInterval(cleanup, 1800000); // Clean every 30 minutes

// Compile and run C/C++ code
async function compileCpp(code, input = '') {
    const fileName = uuidv4();
    const sourcePath = path.join(TEMP_DIR, `${fileName}.cpp`);
    const execPath = path.join(TEMP_DIR, `${fileName}${process.platform === 'win32' ? '.exe' : ''}`);
    const inputPath = path.join(TEMP_DIR, `${fileName}.txt`);

    try {
        // Ensure temp directory exists
        await fs.mkdir(TEMP_DIR, { recursive: true });

        // Write code to file
        await fs.writeFile(sourcePath, code);
        
        // Write input to file if provided
        if (input) {
            await fs.writeFile(inputPath, input);
        }

        // Compile the code
        const compileResult = await new Promise((resolve, reject) => {
            const compileCommand = process.platform === 'win32' 
                ? `g++ "${sourcePath}" -o "${execPath}"`
                : `g++ "${sourcePath}" -o "${execPath}"`;

            exec(compileCommand, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || 'Compilation failed'));
                } else {
                    resolve(stdout);
                }
            });
        });

        // Run the compiled program
        const result = await new Promise((resolve, reject) => {
            const execCommand = process.platform === 'win32' ? `"${execPath}"` : `./${path.basename(execPath)}`;
            const options = {
                timeout: 5000, // 5 second timeout
                cwd: TEMP_DIR // Set working directory to temp folder
            };

            const child = exec(execCommand, options, (error, stdout, stderr) => {
                if (error && error.killed) {
                    reject(new Error('Execution timed out'));
                } else if (error) {
                    reject(new Error(stderr || 'Execution failed'));
                } else {
                    resolve(stdout);
                }
            });

            // Provide input if available
            if (input) {
                child.stdin.write(input);
                child.stdin.end();
            }
        });

        return { success: true, output: result };
    } catch (error) {
        return { 
            success: false, 
            error: error.message,
            details: `Compilation/Execution failed: ${error.message}`
        };
    } finally {
        // Cleanup files
        await Promise.all([
            safeDeleteFile(sourcePath),
            safeDeleteFile(execPath),
            input ? safeDeleteFile(inputPath) : Promise.resolve()
        ]);
    }
}

// Endpoint to run code
app.post('/run', async (req, res) => {
    const { code, language, input, testCases } = req.body;

    try {
        if (language === 'cpp' || language === 'c') {
            if (testCases) {
                // Run all test cases
                const results = [];
                for (const test of testCases) {
                    const result = await compileCpp(code, test.input);
                    results.push({
                        input: test.input,
                        expectedOutput: test.expectedOutput,
                        actualOutput: result.success ? result.output.trim() : result.error,
                        passed: result.success && result.output.trim() === test.expectedOutput.trim(),
                        error: result.success ? null : result.error
                    });
                }
                res.json({ success: true, testResults: results });
            } else {
                // Run single execution
                const result = await compileCpp(code, input);
                res.json(result);
            }
        } else {
            res.status(400).json({ 
                success: false, 
                error: 'Unsupported language',
                details: `Language ${language} is not supported`
            });
        }
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: `Server error: ${error.message}`
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        tempDirectory: TEMP_DIR,
        platform: process.platform
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Temporary directory: ${TEMP_DIR}`);
    console.log(`Platform: ${process.platform}`);
});