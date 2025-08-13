#!/usr/bin/env node

/**
 * Encryption Setup Helper - Generate secure encryption keys for Cognitron05
 * 
 * This script helps set up the required environment variables for data encryption
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

console.log('🔐 Cognitron05 Encryption Setup\n');

/**
 * Generate a secure master key for encryption
 */
function generateMasterKey() {
  const key = crypto.randomBytes(32).toString('hex');
  console.log('✅ Generated 256-bit master key:', key);
  return key;
}

/**
 * Generate a secure JWT secret
 */
function generateJWTSecret() {
  const secret = crypto.randomBytes(64).toString('base64');
  console.log('✅ Generated JWT secret:', secret.substring(0, 20) + '...');
  return secret;
}

/**
 * Create environment file with generated keys
 */
function createEnvFile() {
  const masterKey = generateMasterKey();
  const jwtSecret = generateJWTSecret();
  
  const envContent = `# Cognitron05 Encrypted Environment Configuration
# Generated on ${new Date().toISOString()}

# ENCRYPTION SETTINGS (REQUIRED)
COGNITRON_MASTER_KEY="${masterKey}"
COGNITRON_JWT_SECRET="${jwtSecret}"

# AUTHENTICATION SETTINGS
COGNITRON_ENABLE_AUTH=true
COGNITRON_ENCRYPTION_ENABLED=true
COGNITRON_SEPARATE_MEMORIES=false

# API SETTINGS (REQUIRED - Get from https://console.groq.com)
GROQ_API_KEY="your-groq-api-key-here"

# LOGGING SETTINGS
LOG_LEVEL=INFO
NODE_ENV=development

# SECURITY SETTINGS
COGNITRON_ENABLE_AUDIT=true
COGNITRON_SESSION_TIMEOUT=86400000
COGNITRON_MAX_LOGIN_ATTEMPTS=5
`;

  fs.writeFileSync('.env', envContent);
  console.log('\n📄 Created .env file with secure configuration');
  console.log('⚠️  IMPORTANT: Update GROQ_API_KEY in .env with your actual API key');
}

/**
 * Create example usage script
 */
function createUsageExample() {
  const usage = `#!/bin/bash

# Cognitron05 Encrypted Usage Examples

# Load environment variables
source .env

# Check that required environment variables are set
if [ -z "$COGNITRON_MASTER_KEY" ]; then
  echo "❌ COGNITRON_MASTER_KEY not set"
  exit 1
fi

if [ -z "$GROQ_API_KEY" ]; then
  echo "❌ GROQ_API_KEY not set - get one from https://console.groq.com"
  exit 1
fi

echo "🔐 Starting Cognitron05 with encryption..."

# Start interactive mode
node cognitron05-encrypted.js start

# Examples of single question mode:
# node cognitron05-encrypted.js ask "What is the weather like?"
# node cognitron05-encrypted.js stats
`;

  fs.writeFileSync('run-encrypted.sh', usage);
  fs.chmodSync('run-encrypted.sh', '755');
  console.log('📄 Created run-encrypted.sh usage script');
}

/**
 * Display setup instructions
 */
function displayInstructions() {
  console.log('\n🚀 Setup Complete!\n');
  
  console.log('📋 Next Steps:');
  console.log('1. Edit .env file and add your GROQ_API_KEY from https://console.groq.com');
  console.log('2. Make sure Node.js dependencies are installed: npm install');
  console.log('3. Run the encrypted version: ./run-encrypted.sh');
  console.log('');
  
  console.log('🔑 Commands:');
  console.log('   node cognitron05-encrypted.js start     # Interactive encrypted chat');
  console.log('   node cognitron05-encrypted.js ask "hi"  # Single encrypted question');
  console.log('   node cognitron05-encrypted.js stats     # Show security status');
  console.log('');
  
  console.log('🔒 Security Features:');
  console.log('   ✅ AES-256-GCM encryption for all data');
  console.log('   ✅ Secure key derivation (PBKDF2)');
  console.log('   ✅ User authentication with JWT');
  console.log('   ✅ Role-based access control');
  console.log('   ✅ Encrypted conversation history');
  console.log('   ✅ Secure file operations');
  console.log('   ✅ Audit trails and monitoring');
  console.log('');
  
  console.log('⚠️  Security Notes:');
  console.log('   • Keep your .env file secure and never commit it to version control');
  console.log('   • The master key is used to encrypt all data - losing it means losing access');
  console.log('   • In production, use strong environment variable management');
  console.log('   • Regular key rotation is recommended');
}

/**
 * Main setup function
 */
function main() {
  try {
    console.log('Generating secure encryption keys and configuration...\n');
    
    // Check if .env already exists
    if (fs.existsSync('.env')) {
      console.log('⚠️  .env file already exists');
      console.log('Backup existing file? (y/n)');
      
      // For now, just create a backup
      const backup = `.env.backup.${Date.now()}`;
      fs.copyFileSync('.env', backup);
      console.log(`📄 Backed up existing .env to ${backup}`);
    }
    
    createEnvFile();
    createUsageExample();
    displayInstructions();
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

// Run setup
main();