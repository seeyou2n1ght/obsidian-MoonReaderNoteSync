import { Platform, App, DataAdapter } from 'obsidian';

declare var require: any;
let fsModule: any = null;
if (!Platform.isMobile) {
    try {
        fsModule = require('fs');
    } catch (e) {
        console.warn("Node fs module load error:", e);
    }
}

function bufferToBase64(buf: ArrayBuffer): string {
    return Buffer.from(buf).toString('base64');
}

function base64ToBuffer(b64: string): ArrayBuffer {
    const buf = Buffer.from(b64, 'base64');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export class CryptoHelper {
    private static adapter: DataAdapter | null = null;

    public static init(app: App) {
        this.adapter = app.vault.adapter;
    }

    private static async fileExists(path: string): Promise<boolean> {
        if (!Platform.isMobile && fsModule) {
            return fsModule.existsSync(path);
        }
        if (this.adapter) {
            return await this.adapter.exists(path);
        }
        return false;
    }

    private static async readFile(path: string): Promise<string> {
        if (!Platform.isMobile && fsModule) {
            return fsModule.readFileSync(path, 'utf8');
        }
        if (this.adapter) {
            return await this.adapter.read(path);
        }
        throw new Error("No available file storage adapter found");
    }

    private static async writeFile(path: string, content: string): Promise<void> {
        if (!Platform.isMobile && fsModule) {
            fsModule.writeFileSync(path, content, 'utf8');
            return;
        }
        if (this.adapter) {
            await this.adapter.write(path, content);
            return;
        }
        throw new Error("No available file storage adapter found");
    }

    private static async getRawKey(keyPath: string): Promise<CryptoKey | null> {
        if (!keyPath || !(await this.fileExists(keyPath))) return null;
        try {
            const keyBase64 = await this.readFile(keyPath);
            const keyBuffer = base64ToBuffer(keyBase64);
            return await window.crypto.subtle.importKey(
                "raw",
                keyBuffer,
                { name: "AES-GCM" },
                true,
                ["encrypt", "decrypt"]
            );
        } catch (e) {
            console.error("Failed to read or import key from path:", keyPath, e);
            return null;
        }
    }

    public static async generateAndSaveKey(keyPath: string): Promise<boolean> {
        try {
            const key = await window.crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                true,
                ["encrypt", "decrypt"]
            );
            const exportedKey = await window.crypto.subtle.exportKey("raw", key);
            const keyBase64 = bufferToBase64(exportedKey);
            await this.writeFile(keyPath, keyBase64);
            return true;
        } catch (e) {
            console.error("Failed to generate and save key", e);
            return false;
        }
    }

    public static async encrypt(text: string, keyPath: string): Promise<string> {
        if (!text) return "";
        const key = await this.getRawKey(keyPath);
        if (!key) throw new Error("Key not found at path");
        
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(text);
        
        const cipherText = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            encoded
        );
        
        const ivBase64 = bufferToBase64(iv.buffer as ArrayBuffer);
        const cipherBase64 = bufferToBase64(cipherText);
        return ivBase64 + ":" + cipherBase64;
    }

    public static async decrypt(encryptedData: string, keyPath: string): Promise<string> {
        if (!encryptedData || !encryptedData.includes(":")) return encryptedData; // fallback if plain text
        const [ivBase64, cipherBase64] = encryptedData.split(":");
        const key = await this.getRawKey(keyPath);
        if (!key) throw new Error("Key not found at path");

        const ivBuffer = base64ToBuffer(ivBase64);
        const cipherBuffer = base64ToBuffer(cipherBase64);

        try {
            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: new Uint8Array(ivBuffer) },
                key,
                cipherBuffer
            );
            return new TextDecoder().decode(decrypted);
        } catch (e) {
            console.error("Decryption failed", e);
            return "";
        }
    }
}
