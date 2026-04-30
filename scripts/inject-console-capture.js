const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

const SCRIPT_TAG = '<script src="/dashboard-console-capture.js"></script>';

async function injectConsoleCapture() {
  const buildDir = path.join(process.cwd(), '.next');
  const distDir = path.join(process.cwd(), 'dist');
  const outDir = path.join(process.cwd(), 'out');
  
  // Check which build directory exists
  let targetDir = null;
  if (fs.existsSync(buildDir)) {
    targetDir = buildDir;
    console.log('📁 Found Next.js build directory');
  } else if (fs.existsSync(distDir)) {
    targetDir = distDir;
    console.log('📁 Found dist directory');
  } else if (fs.existsSync(outDir)) {
    targetDir = outDir;
    console.log('📁 Found out directory');
  }
  
  if (!targetDir) {
    console.log('⚠️  No build directory found. Skipping console capture injection.');
    return;
  }
  
  try {
    // Find all HTML files in build output
    const htmlFiles = await glob('**/*.html', { cwd: targetDir, absolute: true });
    
    if (htmlFiles.length === 0) {
      console.log('⚠️  No HTML files found in build output.');
      return;
    }
    
    let injectedCount = 0;
    
    for (const file of htmlFiles) {
      try {
        let content = await fs.promises.readFile(file, 'utf8');
        
        // Skip if script is already injected
        if (content.includes('dashboard-console-capture.js')) {
          continue;
        }
        
        // Try to inject before closing head tag first
        if (content.includes('</head>')) {
          content = content.replace('</head>', `  ${SCRIPT_TAG}\n</head>`);
          injectedCount++;
        }
        // Fallback to inject after opening body tag
        else if (content.includes('<body>')) {
          content = content.replace('<body>', `<body>\n  ${SCRIPT_TAG}`);
          injectedCount++;
        }
        // Last resort: inject at end of file before </html>
        else if (content.includes('</html>')) {
          content = content.replace('</html>', `  ${SCRIPT_TAG}\n</html>`);
          injectedCount++;
        } else {
          console.log(`⚠️  Could not find insertion point in ${file}`);
          continue;
        }
        
        await fs.promises.writeFile(file, content, 'utf8');
        console.log(`✅ Injected console capture script into ${path.relative(process.cwd(), file)}`);
      } catch (fileError) {
        console.error(`❌ Error processing ${file}:`, fileError.message);
      }
    }
    
    if (injectedCount > 0) {
      console.log(`🎉 Successfully injected console capture script into ${injectedCount} HTML file(s)`);
    } else {
      console.log('⚠️  No HTML files were modified. Console capture script may already be present.');
    }
  } catch (error) {
    console.error('❌ Error during console capture injection:', error.message);
  }
}

module.exports = injectConsoleCapture;

// Run the injection
injectConsoleCapture().catch(console.error);