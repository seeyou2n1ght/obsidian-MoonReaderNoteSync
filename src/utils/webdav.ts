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

    private async getAuthHeader(targetUrl?: string): Promise<Record<string, string>> {
        if (!this.username || !this.encryptedPass) return {};
        
        if (targetUrl) {
            try {
                const targetOrigin = new URL(targetUrl).origin;
                const clientOrigin = new URL(this.url).origin;
                if (targetOrigin !== clientOrigin) {
                    console.warn("Target URL is not same-origin with WebDAV client. Stripping credentials.");
                    return {};
                }
            } catch (e) {
                console.error("Failed to parse URL for SSRF validation:", e);
                return {};
            }
        }

        const password = await CryptoHelper.decrypt(this.encryptedPass, this.keyPath);
        if (!password) {
            throw new Error("Decrypted password is empty! The AES key might have changed. Please re-enter your password in the settings.");
        }
        const token = Buffer.from(`${this.username}:${password}`).toString('base64');
        return {
            'Authorization': `Basic ${token}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
    }

    public async testConnection(): Promise<boolean> {
        try {
            const headers = await this.getAuthHeader(this.url);
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

    public async getFiles(): Promise<WebDAVFile[]> {
        const rawUrl = this.url;
        let encodedUrl = rawUrl;
        try {
            const urlObj = new URL(rawUrl);
            urlObj.pathname = urlObj.pathname.split('/').map(s => encodeURIComponent(decodeURIComponent(s))).join('/');
            encodedUrl = urlObj.toString();
        } catch(e) {
            console.error("URL parsing failed", e);
        }

        const headers = await this.getAuthHeader(rawUrl);
        
        // 我们采取双重保障：先尝试标准的 Encoded URL，若被 Alist 报 403 拒绝，则回退到 Raw URL。
        let response;
        try {
            console.log("PROPFIND requesting encoded URL:", encodedUrl);
            response = await requestUrl({
                url: encodedUrl,
                method: 'PROPFIND',
                headers: {
                    ...headers,
                    'Depth': '1',
                    'Accept': '*/*'
                }
            });
        } catch (e: any) {
            console.warn("PROPFIND with encoded URL failed. Retrying with raw URL...", e);
            response = await requestUrl({
                url: rawUrl,
                method: 'PROPFIND',
                headers: {
                    ...headers,
                    'Depth': '1',
                    'Accept': '*/*'
                }
            });
        }

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

    public async getFileBuffer(href: string): Promise<ArrayBuffer> {
        let fullUrl = href;
        // 如果 href 只是一个绝对路径 (例如 /dav/folder/...an)
        if (!href.startsWith('http')) {
            try {
                const baseUrl = new URL(this.url);
                fullUrl = baseUrl.origin + (href.startsWith('/') ? href : '/' + href);
            } catch (e) {
                // 回退处理
                fullUrl = this.url + (href.startsWith('/') ? href.substring(1) : href);
            }
        }

        const headers = await this.getAuthHeader(fullUrl);
        
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
