import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const VAULT_DIR = path.join(os.homedir(), '.ventarys');
const VAULT_FILE = path.join(VAULT_DIR, 'vault.json');
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

const FIXED_SALT = Buffer.from('ventarys-cli-fixed-salt-32bytes!', 'utf8').subarray(0, 32);
const FIXED_PASSWORD = 'ventarys-cli-no-password';

export interface VaultData {
  apiKeys: Record<string, string>;
  localEndpoints: Record<string, string>;
  chatHistory: ChatSession[];
  settings: VaultSettings;
  version: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  model: string;
  provider: string;
  memory?: string;
  isSummarizing?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface VaultSettings {
  defaultModel: string;
  defaultProvider: string;
  theme: string;
  autoSave: boolean;
}

const DEFAULT_VAULT: VaultData = {
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

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

export async function ensureVaultDir(): Promise<void> {
  try {
    await fs.mkdir(VAULT_DIR, { recursive: true, mode: 0o700 });
  } catch {
    // Directory might already exist
  }
}

export async function vaultExists(): Promise<boolean> {
  try {
    await fs.access(VAULT_FILE);
    return true;
  } catch {
    return false;
  }
}

export async function createVault(): Promise<VaultData> {
  await ensureVaultDir();
  const vault = { ...DEFAULT_VAULT };
  await saveVault(vault);
  return vault;
}

export async function unlockVault(): Promise<VaultData> {
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
  } catch {
    // If decryption fails, return default vault
    return { ...DEFAULT_VAULT };
  }
}

export async function saveVault(vault: VaultData): Promise<void> {
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

export async function updateVault(updates: Partial<VaultData>): Promise<VaultData> {
  const vault = await unlockVault();
  const updated = { ...vault, ...updates };
  await saveVault(updated);
  return updated;
}

export function getVaultPath(): string {
  return VAULT_FILE;
}