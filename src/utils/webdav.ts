import { requestUrl, App } from 'obsidian';
export interface WebDAVFile {
    href: string;
    lastModified: string;
    contentType: string;
    contentLength: number;
    isCollection: boolean;
}

export class WebDAVClient {
    private app: App;
    private url: string;
    private username: string;

    constructor(app: App, url: string, username: string) {
        this.app = app;
        this.url = url.endsWith('/') ? url : url + '/';
        this.username = username;
    }

    private async getAuthHeader(targetUrl?: string): Promise<Record<string, string>> {
        if (!this.username) return {};

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

        const password = this.app.secretStorage ? this.app.secretStorage.getSecret("webdav-password") : null;
        if (!password) {
            throw new Error("Password not found in secure storage. Please set your password in the settings.");
        }
        const token = btoa(`${this.username}:${password}`);
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
        
        // 鎴戜滑閲囧彇鍙岄噸淇濋殰锛氬厛灏濊瘯鏍囧噯鐨?Encoded URL锛岃嫢琚?Alist 鎶?403 鎷掔粷锛屽垯鍥為€€鍒?Raw URL銆?
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
        } catch (e: unknown) {
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
        // 濡傛灉 href 鍙槸涓€涓粷瀵硅矾寰?(渚嬪 /dav/folder/...an)
        if (!href.startsWith('http')) {
            try {
                const baseUrl = new URL(this.url);
                fullUrl = baseUrl.origin + (href.startsWith('/') ? href : '/' + href);
            } catch {
                // 鍥為€€澶勭悊
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
