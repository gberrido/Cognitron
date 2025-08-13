#!/usr/bin/env node

/**
 * Configuration management for Cognitron06 CLI Client
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export class ConfigManager {
  constructor() {
    this.configDir = path.join(os.homedir(), '.cognitron06');
    this.configFile = path.join(this.configDir, 'config.json');
    this.secureFile = path.join(this.configDir, 'secure.json');
    this.serviceName = 'cognitron06-cli';
    
    this.defaults = {
      serverUrl: 'http://localhost:8000',
      streamingEnabled: true,
      showTokenUsage: false,
      debugMode: false
    };
    
    this.config = { ...this.defaults };
  }

  async load() {
    try {
      // Ensure config directory exists
      await fs.mkdir(this.configDir, { recursive: true });
      
      // Load config file if it exists
      try {
        const configData = await fs.readFile(this.configFile, 'utf8');
        const savedConfig = JSON.parse(configData);
        this.config = { ...this.defaults, ...savedConfig };
      } catch (error) {
        // Config file doesn't exist, use defaults
        await this.save();
      }
    } catch (error) {
      console.warn(`Warning: Could not load configuration: ${error.message}`);
    }
  }

  async save() {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
      await fs.writeFile(this.configFile, JSON.stringify(this.config, null, 2));
    } catch (error) {
      throw new Error(`Failed to save configuration: ${error.message}`);
    }
  }

  get(key) {
    return this.config[key];
  }

  set(key, value) {
    this.config[key] = value;
  }

  getAll() {
    return { ...this.config };
  }

  async getSecure(key) {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
      const secureData = await fs.readFile(this.secureFile, 'utf8');
      const secure = JSON.parse(secureData);
      return this._decrypt(secure[key]);
    } catch (error) {
      // File doesn't exist or can't be read
      return null;
    }
  }

  async setSecure(key, value) {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
      
      let secure = {};
      try {
        const secureData = await fs.readFile(this.secureFile, 'utf8');
        secure = JSON.parse(secureData);
      } catch (error) {
        // File doesn't exist, start with empty object
      }
      
      secure[key] = this._encrypt(value);
      await fs.writeFile(this.secureFile, JSON.stringify(secure, null, 2), { mode: 0o600 });
    } catch (error) {
      console.warn(`Could not save to secure storage: ${error.message}`);
      throw error;
    }
  }

  async deleteSecure(key) {
    try {
      const secureData = await fs.readFile(this.secureFile, 'utf8');
      const secure = JSON.parse(secureData);
      delete secure[key];
      await fs.writeFile(this.secureFile, JSON.stringify(secure, null, 2), { mode: 0o600 });
      return true;
    } catch (error) {
      console.warn(`Could not delete from secure storage: ${error.message}`);
      return false;
    }
  }

  _getKey() {
    // Simple key derivation from machine info
    const machineInfo = os.hostname() + os.userInfo().username + this.serviceName;
    return crypto.createHash('sha256').update(machineInfo).digest();
  }

  _encrypt(text) {
    if (!text) return null;
    const key = this._getKey().slice(0, 32); // Use first 32 bytes for AES-256
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  _decrypt(encryptedText) {
    if (!encryptedText) return null;
    const key = this._getKey().slice(0, 32); // Use first 32 bytes for AES-256
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  reset() {
    this.config = { ...this.defaults };
  }
}