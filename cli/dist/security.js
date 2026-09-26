"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureVaultDir = ensureVaultDir;
exports.vaultExists = vaultExists;
exports.createVault = createVault;
exports.unlockVault = unlockVault;
exports.saveVault = saveVault;
exports.updateVault = updateVault;
exports.getVaultPath = getVaultPath;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const VAULT_DIR = path.join(os.homedir(), '.ventarys');
const VAULT_FILE = path.join(VAULT_DIR, 'vault.json');
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;
const FIXED_SALT = Buffer.from('ventarys-cli-fixed-salt-32bytes!', 'utf8').subarray(0, 32);
const FIXED_PASSWORD = 'ventarys-cli-no-password';
const DEFAULT_VAULT = {
    apiKeys: {},
    localEndpoints: {
        agnes: 'https://apihub.agnes-ai.com/v1',
        ollama: 'http://localhost:11434/v1',
        lmstudio: 'http://localhost:1234/v1',
    },
    chatHistory: [],
    settings: {
        defaultModel: 'agnes-3.0-flash',
        defaultProvider: 'agnes',
        theme: 'monochrome',
        autoSave: true,
    },
    version: 1,
};
function deriveKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}
async function ensureVaultDir() {
    try {
        await fs.mkdir(VAULT_DIR, { recursive: true, mode: 0o700 });
    }
    catch {
        // Directory might already exist
    }
}
async function vaultExists() {
    try {
        await fs.access(VAULT_FILE);
        return true;
    }
    catch {
        return false;
    }
}
async function createVault() {
    await ensureVaultDir();
    const vault = { ...DEFAULT_VAULT };
    await saveVault(vault);
    return vault;
}
async function unlockVault() {
    if (!(await vaultExists())) {
        return createVault();
    }
    try {
        const encryptedData = await fs.readFile(VAULT_FILE);
        const data = JSON.parse(encryptedData.toString());
        const salt = Buffer.from(data.salt, 'hex');
        const iv = Buffer.from(data.iv, 'hex');
        const ciphertext = Buffer.from(data.ciphertext, 'hex');
        const authTag = Buffer.from(data.authTag, 'hex');
        const key = deriveKey(FIXED_PASSWORD, salt);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return JSON.parse(decrypted.toString('utf8'));
    }
    catch {
        // If decryption fails, return default vault
        return { ...DEFAULT_VAULT };
    }
}
async function saveVault(vault) {
    await ensureVaultDir();
    const salt = FIXED_SALT;
    const key = deriveKey(FIXED_PASSWORD, salt);
    const iv = crypto.randomBytes(IV_LENGTH);
    const plaintext = Buffer.from(JSON.stringify(vault), 'utf8');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encryptedData = {
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        ciphertext: ciphertext.toString('hex'),
        authTag: authTag.toString('hex'),
    };
    await fs.writeFile(VAULT_FILE, JSON.stringify(encryptedData), { mode: 0o600 });
}
async function updateVault(updates) {
    const vault = await unlockVault();
    const updated = { ...vault, ...updates };
    await saveVault(updated);
    return updated;
}
function getVaultPath() {
    return VAULT_FILE;
}
//# sourceMappingURL=security.js.map