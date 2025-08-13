#!/bin/bash

echo "🧹 Cognitron05 Codebase Cleanup Script"
echo "======================================="

# Create archive directory for old versions
mkdir -p archive/legacy-versions
mkdir -p archive/old-tests  
mkdir -p archive/debug-scripts

# Move legacy main versions to archive
echo "📦 Archiving legacy versions..."
mv cognitron05.js archive/legacy-versions/ 2>/dev/null || echo "  cognitron05.js already moved"
mv cognitron05-modular.js archive/legacy-versions/ 2>/dev/null || echo "  cognitron05-modular.js already moved"  
mv cognitron05-encrypted.js archive/legacy-versions/ 2>/dev/null || echo "  cognitron05-encrypted.js already moved"

# Remove test config backups (keep only latest)
echo "🗑️  Removing redundant test config backups..."
rm -f test-config.json.backup.* 2>/dev/null || echo "  No backup files to remove"

# Archive old debug scripts
echo "📦 Archiving debug scripts..."
mv debug-*.js archive/debug-scripts/ 2>/dev/null || echo "  No debug scripts to move"
mv diagnose-*.js archive/debug-scripts/ 2>/dev/null || echo "  No diagnose scripts to move" 
mv enhance-*.js archive/debug-scripts/ 2>/dev/null || echo "  No enhance scripts to move"

# Archive redundant test files (keep core ones)
echo "📦 Archiving redundant test files..."
mv test-debug-*.js archive/old-tests/ 2>/dev/null || echo "  No debug tests to move"
mv test-fixed-*.js archive/old-tests/ 2>/dev/null || echo "  No fixed tests to move"
mv test-final-*.js archive/old-tests/ 2>/dev/null || echo "  No final tests to move"

# Clear old log files
echo "🗑️  Clearing old log files..."
> cognitron05-errors.log 2>/dev/null || echo "  No error log to clear"
rm -f logs/*.log 2>/dev/null || echo "  No log files to remove"

# Clean up temporary test data  
echo "🗑️  Removing temporary test directories..."
rm -rf test-simple-indexed-search* 2>/dev/null || echo "  No indexed search test dirs"
rm -rf test-memgpt-data 2>/dev/null || echo "  No test memgpt data"

echo ""
echo "✅ Cleanup Complete!"
echo ""
echo "📁 Current Production Structure:"
echo "  cognitron05-memgpt.js     ← MemGPT autonomous agent (MAIN)"
echo "  cognitron05-simple.js     ← Simple reliable alternative"  
echo "  modules/                  ← Complex modular architecture"
echo "  archive/                  ← Old versions and debug files"
echo ""
echo "🚀 Ready for production use!"
echo "   Primary: node cognitron05-memgpt.js" 
echo "   Alternative: node cognitron05-simple.js"