// Quick syntax test for server.js
try {
    require('./server.js');
    console.log('✅ Syntax check passed! No JavaScript errors found.');
} catch (error) {
    console.error('❌ Syntax error found:');
    console.error(error.message);
    process.exit(1);
}
