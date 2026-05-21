import { requestUrl, RequestUrlParam } from 'obsidian';
import { CryptoHelper } from './crypto';

export interface WebDAVFile {
    href: string;
    lastModified: string;
    contentType: string;
    contentLength: number;
    isCollection: boolean;
}

export class WebDAVClient {
    private url: string;
    private username: string;
    private encryptedPass: string;
    private keyPath: string;

    constructor(url: string, username: string, encryptedPass: string, keyPath: string) {
        this.url = url.endsWith('/') ? url : url + '/';
        this.username = username;
        this.encryptedPass = encryptedPass;
        this.keyPath = keyPath;
    }

    private async getAuthHeader(): Promise<Record<string, string>> {
        if (!this.username || !this.encryptedPass) return {};
        const password = await CryptoHelper.decrypt(this.encryptedPass, this.keyPath);
        const token = Buffer.from(`${this.username}:${password}`).toString('base64');
        return {
            'Authorization': `Basic ${token}`
        };
    }

    public async testConnection(): Promise<boolean> {
        try {
            const headers = await this.getAuthHeader();
            const response = await requestUrl({
                url: this.url,
                method: 'PROPFIND',
                headers: {
                    ...headers,
                    'Depth': '0'
                }
            });
            return response.status >= 200 && response.status < 300;
        } catch (e) {
            console.error("WebDAV connection test failed", e);
            return false;
        }
    }

    public async getFiles(path: string): Promise<WebDAVFile[]> {
        const fullUrl = this.url + (path.startsWith('/') ? path.substring(1) : path);
        const headers = await this.getAuthHeader();
        
        const response = await requestUrl({
            url: fullUrl,
            method: 'PROPFIND',
            headers: {
                ...headers,
                'Depth': '1'
            }
        });

        if (response.status !== 207) {
            throw new Error(`WebDAV PROPFIND failed with status: ${response.status}`);
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(response.text, "text/xml");
        const responses = doc.getElementsByTagNameNS("*", "response");
        
        const files: WebDAVFile[] = [];
        
        for (let i = 0; i < responses.length; i++) {
            const res = responses[i];
            const href = res.getElementsByTagNameNS("*", "href")[0]?.textContent || "";
            const propstat = res.getElementsByTagNameNS("*", "propstat")[0];
            if (!propstat) continue;
            const prop = propstat.getElementsByTagNameNS("*", "prop")[0];
            if (!prop) continue;
            
            const resType = prop.getElementsByTagNameNS("*", "resourcetype")[0];
            const isCollection = resType && resType.getElementsByTagNameNS("*", "collection").length > 0;
            
            const lastModified = prop.getElementsByTagNameNS("*", "getlastmodified")[0]?.textContent || "";
            const contentType = prop.getElementsByTagNameNS("*", "getcontenttype")[0]?.textContent || "";
            const contentLengthStr = prop.getElementsByTagNameNS("*", "getcontentlength")[0]?.textContent || "0";
            
            // Skip the directory itself (Depth: 1 returns the dir + children)
            // A simple check is if href exactly matches fullUrl path, but it's easier to just check if it's the root we requested
            // We'll return everything and let caller filter.
            
            files.push({
                href: decodeURIComponent(href),
                lastModified,
                contentType,
                contentLength: parseInt(contentLengthStr, 10),
                isCollection
            });
        }
        
        return files;
    }

    public async getFileBuffer(path: string): Promise<ArrayBuffer> {
        const fullUrl = this.url + (path.startsWith('/') ? path.substring(1) : path);
        const headers = await this.getAuthHeader();
        
        const response = await requestUrl({
            url: fullUrl,
            method: 'GET',
            headers
        });
        
        if (response.status >= 200 && response.status < 300) {
            return response.arrayBuffer;
        }
        throw new Error(`WebDAV GET failed with status: ${response.status}`);
    }
}
