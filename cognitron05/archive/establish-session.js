#!/usr/bin/env node

/**
 * Establish a new session by logging in directly via API
 */

import fetch from 'node-fetch';
import { ConfigManager } from '/Users/saladin/Projects/Cognitron/cognitron06/client/src/config.js';

async function establishSession() {
    console.log('🔐 Establishing new session...');
    
    try {
        // Login via API
        const loginResponse = await fetch('http://localhost:8000/api/v1/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: 'demo',
                password: 'demo123'
            })
        });

        if (!loginResponse.ok) {
            throw new Error(`Login failed: ${loginResponse.status} ${loginResponse.statusText}`);
        }

        const loginData = await loginResponse.json();
        console.log('✅ Login successful!');
        console.log(`Session ID: ${loginData.session_id}`);

        // Save the token using ConfigManager
        const config = new ConfigManager();
        await config.load();
        await config.setSecure('accessToken', loginData.access_token);
        
        console.log('✅ Session saved! You can now use simple-cli.js');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        
        // Try creating demo user first
        console.log('🔧 Attempting to create demo user...');
        try {
            const registerResponse = await fetch('http://localhost:8000/api/v1/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: 'username=demo&password=demo&email=demo@example.com'
            });
            
            if (registerResponse.ok) {
                console.log('✅ Demo user created! Retrying login...');
                await establishSession(); // Retry login
            } else {
                console.log('ℹ️  Demo user might already exist, trying admin credentials...');
                
                // Try admin credentials
                const adminLoginResponse = await fetch('http://localhost:8000/api/v1/auth/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: 'username=admin&password=admin'
                });

                if (adminLoginResponse.ok) {
                    const adminData = await adminLoginResponse.json();
                    console.log('✅ Admin login successful!');
                    
                    const config = new ConfigManager();
                    await config.load();
                    await config.setSecure('accessToken', adminData.access_token);
                    
                    console.log('✅ Session saved! You can now use simple-cli.js');
                } else {
                    console.log('❌ Admin login also failed');
                }
            }
        } catch (regError) {
            console.error('❌ Registration error:', regError.message);
        }
    }
}

establishSession();