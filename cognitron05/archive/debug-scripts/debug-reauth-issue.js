#!/usr/bin/env node

/**
 * Debug Re-authentication Issue
 * Isolate and fix the logout/re-auth problem
 */

import chalk from 'chalk';

async function debugReauthIssue() {
  console.log(chalk.cyan('🔍 Debugging Re-authentication Issue\n'));
  
  try {
    const { CognitronSDK } = await import('../cognitron06/client/src/core/CognitronSDK.js');
    
    const sdk = new CognitronSDK({
      serverUrl: 'http://localhost:8000',
      credentials: { username: 'demo', password: 'demo123' },
      debug: true  // Enable debug logging
    });

    console.log(chalk.blue('1️⃣ Initialize SDK...'));
    await sdk.initialize();
    console.log(chalk.green('✅ SDK initialized'));

    console.log(chalk.blue('\n2️⃣ Initial authentication...'));
    const initialAuth = await sdk.authenticate();
    console.log(chalk.green(`✅ Initial auth: ${JSON.stringify(initialAuth, null, 2)}`));
    console.log(chalk.green(`✅ Is authenticated: ${sdk.isAuthenticated}`));

    console.log(chalk.blue('\n3️⃣ Test getCurrentUser...'));
    const userInfo = await sdk.getCurrentUser();
    console.log(chalk.green(`✅ User info: ${JSON.stringify(userInfo, null, 2)}`));

    console.log(chalk.blue('\n4️⃣ Logout...'));
    const logoutResult = await sdk.logout();
    console.log(chalk.green(`✅ Logout result: ${logoutResult}`));
    console.log(chalk.yellow(`📊 Is authenticated after logout: ${sdk.isAuthenticated}`));

    console.log(chalk.blue('\n5️⃣ Attempt re-authentication...'));
    try {
      const reauthResult = await sdk.authenticate();
      console.log(chalk.green(`✅ Re-auth successful: ${JSON.stringify(reauthResult, null, 2)}`));
      console.log(chalk.green(`✅ Is authenticated after re-auth: ${sdk.isAuthenticated}`));
      
      // Test that it actually works
      console.log(chalk.blue('\n6️⃣ Test functionality after re-auth...'));
      const userInfoAfterReauth = await sdk.getCurrentUser();
      console.log(chalk.green(`✅ User info after re-auth: ${JSON.stringify(userInfoAfterReauth, null, 2)}`));
      
      console.log(chalk.green('\n🎉 RE-AUTHENTICATION WORKS!'));
      
    } catch (error) {
      console.log(chalk.red(`❌ Re-authentication failed: ${error.message}`));
      console.log(chalk.yellow(`Stack trace: ${error.stack}`));
      
      // Debug the auth state
      console.log(chalk.blue('\n🔍 Debug auth state...'));
      console.log(`SDK auth token: ${sdk.auth.getToken() ? 'Present' : 'Missing'}`);
      console.log(`SDK is authenticated: ${sdk.isAuthenticated}`);
      
      // Try manual re-authentication
      console.log(chalk.blue('\n7️⃣ Try manual auth with explicit credentials...'));
      try {
        const manualAuth = await sdk.authenticate({ username: 'demo', password: 'demo123' }, true);
        console.log(chalk.green(`✅ Manual auth: ${JSON.stringify(manualAuth, null, 2)}`));
      } catch (manualError) {
        console.log(chalk.red(`❌ Manual auth failed: ${manualError.message}`));
      }
    }

  } catch (error) {
    console.log(chalk.red(`❌ Debug failed: ${error.message}`));
    console.log(chalk.red(`Stack: ${error.stack}`));
  }
}

debugReauthIssue().catch(console.error);