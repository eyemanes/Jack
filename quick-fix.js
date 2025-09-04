#!/usr/bin/env node

/**
 * Quick Fix Script - One-click solution for PnL issues
 * This script automates the entire fix process safely
 */

const { spawn } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(text) {
  return new Promise((resolve) => {
    rl.question(text, resolve);
  });
}

function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`\n🔄 Running: ${command} ${args.join(' ')}`);
    
    const child = spawn('node', [command, ...args], {
      stdio: 'inherit',
      shell: true
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });
  });
}

async function main() {
  console.log('🚀 Jack of all Scans - PnL Fix Script');
  console.log('=====================================\n');
  
  console.log('This script will:');
  console.log('1. 🔍 Analyze your current data for issues');
  console.log('2. 💾 Create a backup of your data');
  console.log('3. 🔧 Fix all corrupted PnL values');
  console.log('4. ✅ Validate the fixes worked');
  console.log('5. 🧪 Test the new calculation system\n');

  const proceed = await question('Do you want to proceed? (y/N): ');
  
  if (proceed.toLowerCase() !== 'y' && proceed.toLowerCase() !== 'yes') {
    console.log('❌ Aborted by user');
    process.exit(0);
  }

  try {
    // Step 1: Analysis
    console.log('\n📊 STEP 1: Analyzing current data...');
    await runCommand('data-cleanup.js', ['--identify-only']);
    
    const continueAfterAnalysis = await question('\n📋 Review the analysis above. Continue with fixes? (y/N): ');
    
    if (continueAfterAnalysis.toLowerCase() !== 'y' && continueAfterAnalysis.toLowerCase() !== 'yes') {
      console.log('❌ Stopped after analysis');
      process.exit(0);
    }

    // Step 2: Dry Run
    console.log('\n🔍 STEP 2: Dry run (showing what would be fixed)...');
    await runCommand('data-cleanup.js'); // Default is dry-run
    
    const continueAfterDryRun = await question('\n📋 Review the dry run above. Apply these fixes? (y/N): ');
    
    if (continueAfterDryRun.toLowerCase() !== 'y' && continueAfterDryRun.toLowerCase() !== 'yes') {
      console.log('❌ Stopped after dry run');
      process.exit(0);
    }

    // Step 3: Backup & Fix
    console.log('\n💾 STEP 3: Creating backup and applying fixes...');
    await runCommand('data-cleanup.js', ['--live', '--backup']);
    
    // Step 4: Validation
    console.log('\n✅ STEP 4: Validating fixes...');
    await runCommand('validation-utility.js', ['--validate']);
    
    // Step 5: Edge Case Testing
    console.log('\n🧪 STEP 5: Testing edge cases...');
    await runCommand('validation-utility.js', ['--edge-cases']);
    
    console.log('\n🎉 SUCCESS! All fixes have been applied successfully!');
    console.log('\n📋 What happened:');
    console.log('✅ All corrupted PnL values were identified and fixed');
    console.log('✅ Your server now uses the improved PnL calculation service');
    console.log('✅ All endpoints will provide consistent calculations');
    console.log('✅ Future corruption will be automatically detected');
    
    console.log('\n🔍 Next Steps:');
    console.log('1. Restart your server to use the new system');
    console.log('2. Monitor logs for any validation warnings');
    console.log('3. Run periodic checks: node validation-utility.js --validate');
    
    console.log('\n📞 If you encounter any issues:');
    console.log('- Check the README_PNL_FIXES.md file for troubleshooting');
    console.log('- Run diagnostics: node validation-utility.js --full');
    console.log('- Review server logs for detailed error messages');

  } catch (error) {
    console.error('\n❌ ERROR during fix process:', error.message);
    console.log('\n🛟 Recovery options:');
    console.log('1. If backup was created, you can restore from backup*.json');
    console.log('2. Run validation to see current state: node validation-utility.js --validate');
    console.log('3. Check logs for specific error details');
    
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n⚠️ Process interrupted by user');
  console.log('Your data has not been modified if the fix process was stopped early.');
  process.exit(0);
});

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };
