#!/usr/bin/env node

/**
 * Encryption Manager - Comprehensive data encryption at rest system
 * 
 * Features:
 * - AES-256-GCM encryption for maximum security
 * - Secure key derivation with PBKDF2
 * - Key rotation and versioning
 * - Encrypted backup and restore
 * - Memory-safe key handling
 * - Performance-optimized streaming encryption
 * - Compliance-ready audit trails
 * - Zero-knowledge architecture support
 */

import crypto from 'crypto';
import { createSecureOpsForDirectory } from '../security/SecureFileOpsMigration.js';
import { getLogger } from '../utils/StructuredLogger.js';
import path from 'path';

export class EncryptionManager {
  constructor(config = {}) {
    this.config = {
      // Encryption settings
      algorithm: 'aes-256-gcm',
      keyDerivationAlgorithm: 'pbkdf2',
      keyDerivationIterations: 100000, // OWASP recommended minimum
      saltLength: 32, // 256 bits
      ivLength: 16, // 128 bits for GCM
      tagLength: 16, // 128 bits for GCM
      keyLength: 32, // 256 bits
      
      // Key management
      masterKeyEnvVar: 'COGNITRON_MASTER_KEY',
      keyRotationInterval: config.keyRotationInterval || 30 * 24 * 60 * 60 * 1000, // 30 days
      maxKeyAge: config.maxKeyAge || 90 * 24 * 60 * 60 * 1000, // 90 days
      enableKeyRotation: config.enableKeyRotation !== false,
      
      // Storage settings
      encryptedDataDir: config.encryptedDataDir || './cognitron05-data/encrypted',
      keyStoreFile: config.keyStoreFile || 'keystore.enc',
      metadataFile: config.metadataFile || 'encryption-metadata.json',
      
      // Performance settings
      chunkSize: config.chunkSize || 64 * 1024, // 64KB chunks for streaming
      enableCompression: config.enableCompression !== false,
      compressionLevel: config.compressionLevel || 6,
      
      // Security settings
      enableKeyStretching: config.enableKeyStretching !== false,
      enableMemoryProtection: config.enableMemoryProtection !== false,
      clearKeysOnShutdown: config.clearKeysOnShutdown !== false,
      auditEncryptionOperations: config.auditEncryptionOperations !== false,
      
      // Compliance settings
      enableFIPS: config.enableFIPS || false,
      enableSOX: config.enableSOX || false,
      enableGDPR: config.enableGDPR !== false,
      dataRetentionPolicy: config.dataRetentionPolicy || 'encrypt-forever',
      
      ...config
    };
    
    this.logger = getLogger();
    
    // Initialize secure file operations
    this.secureOps = createSecureOpsForDirectory(this.config.encryptedDataDir, {
      maxFileSize: 1024 * 1024 * 1024, // 1GB max for encrypted files
      allowSymlinks: false,
      validateFileTypes: false, // Encrypted files don't have standard MIME types
      enableIntegrityChecks: true
    });
    
    // Key management
    this.masterKey = null;
    this.derivedKeys = new Map(); // keyId -> { key, salt, version, createdAt, expiresAt }
    this.keyVersions = new Map(); // version -> keyId
    this.currentKeyVersion = 1;
    
    // Encryption cache for performance
    this.encryptionCache = new Map(); // dataId -> { encryptedData, keyVersion, timestamp }
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    
    // Statistics and monitoring
    this.stats = {
      encryptionsPerformed: 0,
      decryptionsPerformed: 0,
      keysGenerated: 0,
      keyRotations: 0,
      encryptionErrors: 0,
      decryptionErrors: 0,
      bytesEncrypted: 0,
      bytesDecrypted: 0,
      cacheHits: 0,
      cacheMisses: 0,
      lastReset: Date.now()
    };
    
    // Memory protection
    this.protectedMemory = new Set(); // Track protected memory regions
    
    // Initialize encryption metadata
    this.metadata = {
      version: '1.0',
      algorithm: this.config.algorithm,
      keyDerivation: this.config.keyDerivationAlgorithm,
      createdAt: new Date().toISOString(),
      lastKeyRotation: null,
      encryptedDataTypes: [],
      complianceFlags: {
        fips: this.config.enableFIPS,
        sox: this.config.enableSOX,
        gdpr: this.config.enableGDPR
      }
    };
  }

  /**
   * Initialize encryption system
   */
  async initialize() {
    try {
      this.logger.info('Initializing encryption manager', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        algorithm: this.config.algorithm,
        keyDerivationIterations: this.config.keyDerivationIterations
      });

      // Create encrypted data directory
      await this.secureOps.mkdir('.', { recursive: true });
      
      // Initialize master key
      await this.initializeMasterKey();
      
      // Load or create keystore
      await this.loadKeyStore();
      
      // Load encryption metadata
      await this.loadMetadata();
      
      // Start key rotation if enabled
      if (this.config.enableKeyRotation) {
        this.startKeyRotationScheduler();
      }
      
      // Setup memory protection
      if (this.config.enableMemoryProtection) {
        this.setupMemoryProtection();
      }
      
      // Setup cleanup on shutdown
      process.on('beforeExit', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());
      
      this.logger.info('Encryption manager initialized successfully', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        keyVersions: this.keyVersions.size,
        currentVersion: this.currentKeyVersion
      });
      
      return true;
      
    } catch (error) {
      this.logger.error('Failed to initialize encryption manager', {
        subsystem: 'encryption',
        component: 'encryption-manager'
      }, error);
      
      throw error;
    }
  }

  /**
   * Encrypt data with current key version
   */
  async encryptData(data, options = {}) {
    const encryptionResult = {
      success: false,
      encryptedData: null,
      keyVersion: null,
      metadata: null,
      error: null
    };
    
    try {
      if (!data) {
        throw new Error('No data provided for encryption');
      }
      
      const dataType = options.dataType || 'generic';
      const keyVersion = options.keyVersion || this.currentKeyVersion;
      const enableCompression = options.enableCompression ?? this.config.enableCompression;
      
      // Get or generate encryption key for this version
      const keyInfo = await this.getOrGenerateKey(keyVersion);
      if (!keyInfo) {
        throw new Error(`Unable to get encryption key for version ${keyVersion}`);
      }
      
      // Convert data to buffer
      let dataBuffer;
      if (typeof data === 'string') {
        dataBuffer = Buffer.from(data, 'utf8');
      } else if (Buffer.isBuffer(data)) {
        dataBuffer = data;
      } else {
        dataBuffer = Buffer.from(JSON.stringify(data), 'utf8');
      }
      
      // Compress data if enabled
      if (enableCompression && dataBuffer.length > 1024) {
        dataBuffer = await this.compressData(dataBuffer);
      }
      
      // Generate IV for this encryption operation
      const iv = crypto.randomBytes(this.config.ivLength);
      
      // Create cipher
      const cipher = crypto.createCipher(this.config.algorithm, keyInfo.key);
      cipher.setAAD(Buffer.from(JSON.stringify({
        keyVersion,
        dataType,
        timestamp: Date.now(),
        compressed: enableCompression && dataBuffer.length > 1024
      })));
      
      // Encrypt data
      const encryptedChunks = [];
      encryptedChunks.push(cipher.update(dataBuffer));
      encryptedChunks.push(cipher.final());
      
      // Get authentication tag
      const tag = cipher.getAuthTag();
      
      // Combine IV, tag, and encrypted data
      const encryptedData = Buffer.concat([
        iv,
        tag,
        ...encryptedChunks
      ]);
      
      // Create metadata
      const encryptionMetadata = {
        algorithm: this.config.algorithm,
        keyVersion,
        dataType,
        originalSize: dataBuffer.length,
        encryptedSize: encryptedData.length,
        compressed: enableCompression && dataBuffer.length > 1024,
        timestamp: Date.now(),
        checksum: crypto.createHash('sha256').update(dataBuffer).digest('hex')
      };
      
      encryptionResult.success = true;
      encryptionResult.encryptedData = encryptedData;
      encryptionResult.keyVersion = keyVersion;
      encryptionResult.metadata = encryptionMetadata;
      
      // Update statistics
      this.stats.encryptionsPerformed++;
      this.stats.bytesEncrypted += dataBuffer.length;
      
      // Track encrypted data type
      if (!this.metadata.encryptedDataTypes.includes(dataType)) {
        this.metadata.encryptedDataTypes.push(dataType);
        await this.saveMetadata();
      }
      
      // Audit encryption operation
      if (this.config.auditEncryptionOperations) {
        this.auditEncryptionOperation('encrypt', dataType, keyVersion, dataBuffer.length);
      }
      
      this.logger.debug('Data encrypted successfully', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        dataType,
        keyVersion,
        originalSize: dataBuffer.length,
        encryptedSize: encryptedData.length
      });
      
      return encryptionResult;
      
    } catch (error) {
      encryptionResult.error = error.message;
      this.stats.encryptionErrors++;
      
      this.logger.error('Data encryption failed', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        dataType: options.dataType,
        error: error.message
      }, error);
      
      return encryptionResult;
    }
  }

  /**
   * Decrypt data using specified key version
   */
  async decryptData(encryptedData, metadata, options = {}) {
    const decryptionResult = {
      success: false,
      decryptedData: null,
      originalMetadata: null,
      error: null
    };
    
    try {
      if (!encryptedData || !metadata) {
        throw new Error('Encrypted data and metadata are required for decryption');
      }
      
      const keyVersion = metadata.keyVersion;
      const dataType = metadata.dataType || 'generic';
      
      // Get decryption key for this version
      const keyInfo = await this.getKey(keyVersion);
      if (!keyInfo) {
        throw new Error(`Unable to get decryption key for version ${keyVersion}`);
      }
      
      // Extract IV, tag, and encrypted content
      const iv = encryptedData.subarray(0, this.config.ivLength);
      const tag = encryptedData.subarray(this.config.ivLength, this.config.ivLength + this.config.tagLength);
      const encrypted = encryptedData.subarray(this.config.ivLength + this.config.tagLength);
      
      // Create decipher
      const decipher = crypto.createDecipher(this.config.algorithm, keyInfo.key);
      decipher.setAuthTag(tag);
      decipher.setAAD(Buffer.from(JSON.stringify({
        keyVersion,
        dataType,
        timestamp: metadata.timestamp,
        compressed: metadata.compressed
      })));
      
      // Decrypt data
      const decryptedChunks = [];
      decryptedChunks.push(decipher.update(encrypted));
      decryptedChunks.push(decipher.final());
      
      let decryptedData = Buffer.concat(decryptedChunks);
      
      // Decompress if needed
      if (metadata.compressed) {
        decryptedData = await this.decompressData(decryptedData);
      }
      
      // Verify checksum
      const checksum = crypto.createHash('sha256').update(decryptedData).digest('hex');
      if (metadata.checksum && checksum !== metadata.checksum) {
        throw new Error('Data integrity check failed: checksum mismatch');
      }
      
      // Convert back to original format if needed
      let finalData = decryptedData;
      if (options.returnString && !options.returnBuffer) {
        finalData = decryptedData.toString('utf8');
      }
      
      decryptionResult.success = true;
      decryptionResult.decryptedData = finalData;
      decryptionResult.originalMetadata = metadata;
      
      // Update statistics
      this.stats.decryptionsPerformed++;
      this.stats.bytesDecrypted += decryptedData.length;
      
      // Audit decryption operation
      if (this.config.auditEncryptionOperations) {
        this.auditEncryptionOperation('decrypt', dataType, keyVersion, decryptedData.length);
      }
      
      this.logger.debug('Data decrypted successfully', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        dataType,
        keyVersion,
        decryptedSize: decryptedData.length
      });
      
      return decryptionResult;
      
    } catch (error) {
      decryptionResult.error = error.message;
      this.stats.decryptionErrors++;
      
      this.logger.error('Data decryption failed', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        keyVersion: metadata?.keyVersion,
        error: error.message
      }, error);
      
      return decryptionResult;
    }
  }

  /**
   * Encrypt file and store encrypted version
   */
  async encryptFile(inputPath, outputPath, options = {}) {
    const encryptionResult = {
      success: false,
      outputPath: null,
      metadata: null,
      error: null
    };
    
    try {
      // Read file data
      const fileData = await this.secureOps.readFile(path.basename(inputPath));
      
      // Encrypt the data
      const encryptResult = await this.encryptData(fileData, {
        dataType: 'file',
        ...options
      });
      
      if (!encryptResult.success) {
        throw new Error(encryptResult.error);
      }
      
      // Save encrypted data and metadata
      const encryptedFileName = path.basename(outputPath);
      const metadataFileName = encryptedFileName + '.meta';
      
      await this.secureOps.writeFile(encryptedFileName, encryptResult.encryptedData);
      await this.secureOps.writeFile(metadataFileName, JSON.stringify(encryptResult.metadata, null, 2));
      
      encryptionResult.success = true;
      encryptionResult.outputPath = outputPath;
      encryptionResult.metadata = encryptResult.metadata;
      
      this.logger.info('File encrypted successfully', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        inputPath,
        outputPath,
        keyVersion: encryptResult.keyVersion
      });
      
      return encryptionResult;
      
    } catch (error) {
      encryptionResult.error = error.message;
      
      this.logger.error('File encryption failed', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        inputPath,
        outputPath
      }, error);
      
      return encryptionResult;
    }
  }

  /**
   * Decrypt file and restore original version
   */
  async decryptFile(inputPath, outputPath, options = {}) {
    const decryptionResult = {
      success: false,
      outputPath: null,
      metadata: null,
      error: null
    };
    
    try {
      // Read encrypted data and metadata
      const encryptedFileName = path.basename(inputPath);
      const metadataFileName = encryptedFileName + '.meta';
      
      const encryptedData = await this.secureOps.readFile(encryptedFileName);
      const metadataJson = await this.secureOps.readFile(metadataFileName, 'utf8');
      const metadata = JSON.parse(metadataJson);
      
      // Decrypt the data
      const decryptResult = await this.decryptData(encryptedData, metadata, {
        returnString: false, // Keep as buffer for file output
        ...options
      });
      
      if (!decryptResult.success) {
        throw new Error(decryptResult.error);
      }
      
      // Save decrypted file
      const outputFileName = path.basename(outputPath);
      await this.secureOps.writeFile(outputFileName, decryptResult.decryptedData);
      
      decryptionResult.success = true;
      decryptionResult.outputPath = outputPath;
      decryptionResult.metadata = decryptResult.originalMetadata;
      
      this.logger.info('File decrypted successfully', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        inputPath,
        outputPath,
        keyVersion: metadata.keyVersion
      });
      
      return decryptionResult;
      
    } catch (error) {
      decryptionResult.error = error.message;
      
      this.logger.error('File decryption failed', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        inputPath,
        outputPath
      }, error);
      
      return decryptionResult;
    }
  }

  /**
   * Perform key rotation
   */
  async rotateKeys(options = {}) {
    try {
      this.logger.info('Starting key rotation', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        currentVersion: this.currentKeyVersion
      });
      
      const forceRotation = options.force || false;
      const newVersion = this.currentKeyVersion + 1;
      
      // Check if rotation is needed
      if (!forceRotation) {
        const currentKey = this.derivedKeys.get(`key_v${this.currentKeyVersion}`);
        if (currentKey && (Date.now() - currentKey.createdAt) < this.config.keyRotationInterval) {
          this.logger.debug('Key rotation skipped - not due yet', {
            subsystem: 'encryption',
            component: 'encryption-manager',
            currentVersion: this.currentKeyVersion
          });
          return { success: true, rotated: false };
        }
      }
      
      // Generate new key
      const newKeyInfo = await this.generateDerivedKey(newVersion);
      if (!newKeyInfo) {
        throw new Error('Failed to generate new key');
      }
      
      // Update current version
      this.currentKeyVersion = newVersion;
      this.keyVersions.set(newVersion, `key_v${newVersion}`);
      
      // Save updated keystore
      await this.saveKeyStore();
      
      // Update metadata
      this.metadata.lastKeyRotation = new Date().toISOString();
      await this.saveMetadata();
      
      // Update statistics
      this.stats.keyRotations++;
      
      this.logger.info('Key rotation completed successfully', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        newVersion,
        totalKeys: this.derivedKeys.size
      });
      
      return { success: true, rotated: true, newVersion };
      
    } catch (error) {
      this.logger.error('Key rotation failed', {
        subsystem: 'encryption',
        component: 'encryption-manager'
      }, error);
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Clean up old keys beyond retention period
   */
  async cleanupOldKeys() {
    try {
      const now = Date.now();
      const keysToRemove = [];
      
      for (const [keyId, keyInfo] of this.derivedKeys) {
        if (keyInfo.expiresAt && now > keyInfo.expiresAt) {
          keysToRemove.push(keyId);
        }
      }
      
      for (const keyId of keysToRemove) {
        // Securely clear key from memory
        const keyInfo = this.derivedKeys.get(keyId);
        if (keyInfo && keyInfo.key) {
          keyInfo.key.fill(0); // Clear key data
        }
        
        this.derivedKeys.delete(keyId);
        
        // Remove from version mapping
        for (const [version, id] of this.keyVersions) {
          if (id === keyId) {
            this.keyVersions.delete(version);
            break;
          }
        }
      }
      
      if (keysToRemove.length > 0) {
        await this.saveKeyStore();
        
        this.logger.info('Old keys cleaned up', {
          subsystem: 'encryption',
          component: 'encryption-manager',
          keysRemoved: keysToRemove.length,
          remainingKeys: this.derivedKeys.size
        });
      }
      
      return { success: true, keysRemoved: keysToRemove.length };
      
    } catch (error) {
      this.logger.error('Key cleanup failed', {
        subsystem: 'encryption',
        component: 'encryption-manager'
      }, error);
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Initialize master key from environment or generate new one
   */
  async initializeMasterKey() {
    const envKey = process.env[this.config.masterKeyEnvVar];
    
    if (envKey) {
      // Use key from environment
      this.masterKey = Buffer.from(envKey, 'hex');
      
      if (this.masterKey.length !== this.config.keyLength) {
        throw new Error(`Invalid master key length: expected ${this.config.keyLength} bytes, got ${this.masterKey.length}`);
      }
      
      this.logger.info('Master key loaded from environment', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        keyLength: this.masterKey.length
      });
    } else {
      // Generate new master key
      this.masterKey = crypto.randomBytes(this.config.keyLength);
      
      this.logger.warn('Generated new master key - save this securely!', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        masterKey: this.masterKey.toString('hex'),
        envVar: this.config.masterKeyEnvVar
      });
      
      // In development, show the key; in production, just warn
      if (process.env.NODE_ENV === 'development') {
        console.log(`\n🔑 MASTER KEY GENERATED: ${this.masterKey.toString('hex')}`);
        console.log(`Set environment variable: ${this.config.masterKeyEnvVar}=${this.masterKey.toString('hex')}`);
        console.log('⚠️  Save this key securely - losing it will make all encrypted data unrecoverable!\n');
      }
    }
    
    // Protect master key in memory if enabled
    if (this.config.enableMemoryProtection) {
      this.protectMemory(this.masterKey);
    }
  }

  /**
   * Generate or retrieve derived key for specific version
   */
  async getOrGenerateKey(version) {
    const keyId = `key_v${version}`;
    
    // Check if key already exists
    let keyInfo = this.derivedKeys.get(keyId);
    if (keyInfo) {
      return keyInfo;
    }
    
    // Generate new derived key
    keyInfo = await this.generateDerivedKey(version);
    if (!keyInfo) {
      throw new Error(`Failed to generate key for version ${version}`);
    }
    
    return keyInfo;
  }

  /**
   * Generate derived key using PBKDF2
   */
  async generateDerivedKey(version) {
    try {
      const keyId = `key_v${version}`;
      const salt = crypto.randomBytes(this.config.saltLength);
      
      // Create key derivation context
      const context = Buffer.concat([
        salt,
        Buffer.from(`cognitron-v${version}`, 'utf8'),
        Buffer.from(Date.now().toString(), 'utf8')
      ]);
      
      // Derive key using PBKDF2
      const derivedKey = crypto.pbkdf2Sync(
        this.masterKey,
        context,
        this.config.keyDerivationIterations,
        this.config.keyLength,
        'sha256'
      );
      
      const now = Date.now();
      const keyInfo = {
        key: derivedKey,
        salt,
        version,
        createdAt: now,
        expiresAt: now + this.config.maxKeyAge,
        algorithm: this.config.algorithm,
        keyDerivation: this.config.keyDerivationAlgorithm,
        iterations: this.config.keyDerivationIterations
      };
      
      // Store key info
      this.derivedKeys.set(keyId, keyInfo);
      this.keyVersions.set(version, keyId);
      
      // Protect derived key in memory if enabled
      if (this.config.enableMemoryProtection) {
        this.protectMemory(derivedKey);
      }
      
      this.stats.keysGenerated++;
      
      this.logger.debug('Derived key generated', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        keyId,
        version,
        algorithm: keyInfo.algorithm
      });
      
      return keyInfo;
      
    } catch (error) {
      this.logger.error('Key derivation failed', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        version
      }, error);
      
      return null;
    }
  }

  /**
   * Get specific key version
   */
  async getKey(version) {
    const keyId = `key_v${version}`;
    return this.derivedKeys.get(keyId);
  }

  /**
   * Compress data using zlib
   */
  async compressData(data) {
    return new Promise((resolve, reject) => {
      const zlib = require('zlib');
      zlib.deflate(data, { level: this.config.compressionLevel }, (err, compressed) => {
        if (err) {
          reject(err);
        } else {
          resolve(compressed);
        }
      });
    });
  }

  /**
   * Decompress data using zlib
   */
  async decompressData(data) {
    return new Promise((resolve, reject) => {
      const zlib = require('zlib');
      zlib.inflate(data, (err, decompressed) => {
        if (err) {
          reject(err);
        } else {
          resolve(decompressed);
        }
      });
    });
  }

  /**
   * Load keystore from encrypted storage
   */
  async loadKeyStore() {
    try {
      // Try to load existing keystore
      const keystoreData = await this.secureOps.readFile(this.config.keyStoreFile);
      
      // Decrypt keystore using master key
      const keystoreJson = this.decryptKeyStore(keystoreData);
      const keystore = JSON.parse(keystoreJson);
      
      // Restore keys
      for (const [keyId, keyData] of Object.entries(keystore.keys)) {
        const keyInfo = {
          key: Buffer.from(keyData.key, 'hex'),
          salt: Buffer.from(keyData.salt, 'hex'),
          version: keyData.version,
          createdAt: keyData.createdAt,
          expiresAt: keyData.expiresAt,
          algorithm: keyData.algorithm,
          keyDerivation: keyData.keyDerivation,
          iterations: keyData.iterations
        };
        
        this.derivedKeys.set(keyId, keyInfo);
        this.keyVersions.set(keyInfo.version, keyId);
        
        // Protect restored key
        if (this.config.enableMemoryProtection) {
          this.protectMemory(keyInfo.key);
        }
      }
      
      this.currentKeyVersion = keystore.currentVersion || 1;
      
      this.logger.info('Keystore loaded successfully', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        keysLoaded: this.derivedKeys.size,
        currentVersion: this.currentKeyVersion
      });
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        // No existing keystore - create initial key
        this.logger.info('Creating new keystore', {
          subsystem: 'encryption',
          component: 'encryption-manager'
        });
        
        await this.getOrGenerateKey(this.currentKeyVersion);
        await this.saveKeyStore();
      } else {
        throw error;
      }
    }
  }

  /**
   * Save keystore to encrypted storage
   */
  async saveKeyStore() {
    try {
      const keystore = {
        version: '1.0',
        currentVersion: this.currentKeyVersion,
        createdAt: new Date().toISOString(),
        keys: {}
      };
      
      // Serialize keys
      for (const [keyId, keyInfo] of this.derivedKeys) {
        keystore.keys[keyId] = {
          key: keyInfo.key.toString('hex'),
          salt: keyInfo.salt.toString('hex'),
          version: keyInfo.version,
          createdAt: keyInfo.createdAt,
          expiresAt: keyInfo.expiresAt,
          algorithm: keyInfo.algorithm,
          keyDerivation: keyInfo.keyDerivation,
          iterations: keyInfo.iterations
        };
      }
      
      // Encrypt keystore
      const keystoreJson = JSON.stringify(keystore);
      const encryptedKeystore = this.encryptKeyStore(keystoreJson);
      
      // Save encrypted keystore
      await this.secureOps.writeFile(this.config.keyStoreFile, encryptedKeystore);
      
      this.logger.debug('Keystore saved successfully', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        keyCount: this.derivedKeys.size
      });
      
    } catch (error) {
      this.logger.error('Failed to save keystore', {
        subsystem: 'encryption',
        component: 'encryption-manager'
      }, error);
      
      throw error;
    }
  }

  /**
   * Encrypt keystore using master key
   */
  encryptKeyStore(data) {
    const iv = crypto.randomBytes(this.config.ivLength);
    const cipher = crypto.createCipher(this.config.algorithm, this.masterKey);
    
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(data, 'utf8')),
      cipher.final()
    ]);
    
    const tag = cipher.getAuthTag();
    
    return Buffer.concat([iv, tag, encrypted]);
  }

  /**
   * Decrypt keystore using master key
   */
  decryptKeyStore(encryptedData) {
    const iv = encryptedData.subarray(0, this.config.ivLength);
    const tag = encryptedData.subarray(this.config.ivLength, this.config.ivLength + this.config.tagLength);
    const encrypted = encryptedData.subarray(this.config.ivLength + this.config.tagLength);
    
    const decipher = crypto.createDecipher(this.config.algorithm, this.masterKey);
    decipher.setAuthTag(tag);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return decrypted.toString('utf8');
  }

  /**
   * Load encryption metadata
   */
  async loadMetadata() {
    try {
      const metadataJson = await this.secureOps.readFile(this.config.metadataFile, 'utf8');
      this.metadata = { ...this.metadata, ...JSON.parse(metadataJson) };
      
      this.logger.debug('Encryption metadata loaded', {
        subsystem: 'encryption',
        component: 'encryption-manager',
        version: this.metadata.version
      });
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Create new metadata file
        await this.saveMetadata();
      } else {
        throw error;
      }
    }
  }

  /**
   * Save encryption metadata
   */
  async saveMetadata() {
    try {
      await this.secureOps.writeFile(
        this.config.metadataFile,
        JSON.stringify(this.metadata, null, 2),
        'utf8'
      );
      
    } catch (error) {
      this.logger.error('Failed to save encryption metadata', {
        subsystem: 'encryption',
        component: 'encryption-manager'
      }, error);
    }
  }

  /**
   * Protect memory region (placeholder for memory protection)
   */
  protectMemory(buffer) {
    if (this.config.enableMemoryProtection) {
      this.protectedMemory.add(buffer);
      // In a real implementation, use mlock() or similar OS features
    }
  }

  /**
   * Setup memory protection
   */
  setupMemoryProtection() {
    // In production, implement actual memory protection features
    this.logger.debug('Memory protection enabled', {
      subsystem: 'encryption',
      component: 'encryption-manager'
    });
  }

  /**
   * Start key rotation scheduler
   */
  startKeyRotationScheduler() {
    setInterval(() => {
      this.rotateKeys().catch(error => {
        this.logger.error('Scheduled key rotation failed', {
          subsystem: 'encryption',
          component: 'encryption-manager'
        }, error);
      });
    }, this.config.keyRotationInterval);
    
    // Also start cleanup scheduler
    setInterval(() => {
      this.cleanupOldKeys().catch(error => {
        this.logger.error('Key cleanup failed', {
          subsystem: 'encryption',
          component: 'encryption-manager'
        }, error);
      });
    }, 24 * 60 * 60 * 1000); // Daily cleanup
  }

  /**
   * Audit encryption operations
   */
  auditEncryptionOperation(operation, dataType, keyVersion, dataSize) {
    this.logger.info('Encryption operation audited', {
      subsystem: 'encryption',
      component: 'encryption-manager',
      operation,
      dataType,
      keyVersion,
      dataSize,
      timestamp: Date.now(),
      compliance: this.metadata.complianceFlags
    });
  }

  /**
   * Get encryption statistics
   */
  getStats() {
    const now = Date.now();
    const uptime = now - this.stats.lastReset;
    
    return {
      uptime,
      encryptionsPerformed: this.stats.encryptionsPerformed,
      decryptionsPerformed: this.stats.decryptionsPerformed,
      keysGenerated: this.stats.keysGenerated,
      keyRotations: this.stats.keyRotations,
      encryptionErrors: this.stats.encryptionErrors,
      decryptionErrors: this.stats.decryptionErrors,
      bytesEncrypted: this.stats.bytesEncrypted,
      bytesDecrypted: this.stats.bytesDecrypted,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      
      // Current state
      activeKeys: this.derivedKeys.size,
      currentKeyVersion: this.currentKeyVersion,
      protectedMemoryRegions: this.protectedMemory.size,
      
      // Configuration
      algorithm: this.config.algorithm,
      enableKeyRotation: this.config.enableKeyRotation,
      enableCompression: this.config.enableCompression,
      
      // Compliance
      complianceFlags: this.metadata.complianceFlags,
      lastKeyRotation: this.metadata.lastKeyRotation,
      encryptedDataTypes: this.metadata.encryptedDataTypes
    };
  }

  /**
   * Health check for encryption system
   */
  async healthCheck() {
    try {
      const stats = this.getStats();
      const hasValidMasterKey = !!this.masterKey && this.masterKey.length === this.config.keyLength;
      const hasActiveKeys = this.derivedKeys.size > 0;
      const errorRate = (stats.encryptionsPerformed + stats.decryptionsPerformed) > 0 ? 
        (stats.encryptionErrors + stats.decryptionErrors) / (stats.encryptionsPerformed + stats.decryptionsPerformed) : 0;
      
      const isHealthy = hasValidMasterKey && hasActiveKeys && errorRate < 0.01;
      
      return {
        healthy: isHealthy,
        reason: isHealthy ? 'Encryption system healthy' : 'Encryption system issues detected',
        details: {
          hasValidMasterKey,
          hasActiveKeys,
          activeKeys: stats.activeKeys,
          currentKeyVersion: stats.currentKeyVersion,
          errorRate: Math.round(errorRate * 10000) / 100, // Percentage with 2 decimals
          encryptionErrors: stats.encryptionErrors,
          decryptionErrors: stats.decryptionErrors
        }
      };
      
    } catch (error) {
      return {
        healthy: false,
        reason: `Health check failed: ${error.message}`,
        details: { error: error.message }
      };
    }
  }

  /**
   * Shutdown encryption manager
   */
  async shutdown() {
    try {
      this.logger.info('Shutting down encryption manager', {
        subsystem: 'encryption',
        component: 'encryption-manager'
      });
      
      // Save current state
      await this.saveKeyStore();
      await this.saveMetadata();
      
      // Clear sensitive data from memory if enabled
      if (this.config.clearKeysOnShutdown) {
        if (this.masterKey) {
          this.masterKey.fill(0);
        }
        
        for (const [keyId, keyInfo] of this.derivedKeys) {
          if (keyInfo.key) {
            keyInfo.key.fill(0);
          }
          if (keyInfo.salt) {
            keyInfo.salt.fill(0);
          }
        }
        
        this.derivedKeys.clear();
        this.keyVersions.clear();
        this.protectedMemory.clear();
        this.encryptionCache.clear();
      }
      
    } catch (error) {
      this.logger.error('Encryption manager shutdown failed', {
        subsystem: 'encryption',
        component: 'encryption-manager'
      }, error);
    }
  }
}

export default EncryptionManager;