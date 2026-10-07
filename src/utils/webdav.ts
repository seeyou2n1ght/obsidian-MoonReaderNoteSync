import { requestUrl } from 'obsidian';
import { t, UserError } from '../i18n';

export interface WebDAVFile {
    href: string;
    lastModified: string;
    contentLength: number;
    isCollection: boolean;
}
export function normalizeWebDavUrl(value: string): string {
    try {
        const url = new URL(value.trim());
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
        if (!url.pathname.endsWith('/')) url.pathname += '/';
        return url.href;
    } catch {
        throw new UserError(t('请输入完整的 HTTP(S) WebDAV 目录地址，账号和密码请单独填写。', 'Enter a full HTTP(S) WebDAV folder URL; enter credentials separately.'));
    }
}
export class WebDAVClient {
    private url: string;
    constructor(url: string, private username: string, private password: string, private signal?: AbortSignal, private timeoutMs?: number) {
        this.url = normalizeWebDavUrl(url);
    }
    // Test a draft without persisting credentials.
    static testConnection(url: string, username: string, password: string, signal?: AbortSignal, timeoutMs = 30_000): Promise<WebDAVFile[]> {
        return new WebDAVClient(url, username, password, signal, timeoutMs).getFiles();
    }
    private async request(url: string, method: string) {
        if (new URL(url).origin !== new URL(this.url).origin) {
            throw new UserError(t('服务器返回了其他站点的文件地址，已停止下载。', 'The server returned a file on another site. Download stopped.'));
        }
        const password = this.password;
        if (!password) throw new UserError(t('请填写 WebDAV 密码。', 'Enter your WebDAV password.'));
        const cancelled = () => new UserError(t('连接检查已取消。', 'Connection check cancelled.'));
        if (this.signal?.aborted) throw cancelled();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort: (() => void) | undefined;
        const interruption = new Promise<never>((_, reject) => {
            abort = () => reject(cancelled());
            this.signal?.addEventListener('abort', abort, { once: true });
            if (this.timeoutMs !== undefined) timer = setTimeout(() => reject(new UserError(t('连接检查超时，请检查服务器后重试。', 'Connection check timed out. Check the server and retry.'))), this.timeoutMs);
        });
        try {
            // requestUrl has no abort API; stop waiting and discard its late response.
            const response = await Promise.race([requestUrl({ url, method, throw: false, headers: {
                Authorization: 'Basic ' + Buffer.from(this.username + ':' + password).toString('base64'),
                ...(method === 'PROPFIND' ? { Depth: '1' } : {})
            } }), interruption]);
            if (response.status < 200 || response.status >= 300) throw Object.assign(new Error('WebDAV request failed'), { status: response.status });
            return response;
        } finally {
            if (timer !== undefined) clearTimeout(timer);
            if (abort) this.signal?.removeEventListener('abort', abort);
        }
    }
    async getFiles(): Promise<WebDAVFile[]> {
        const response = await this.request(this.url, 'PROPFIND');
        if (response.status !== 207) throw new UserError(t('服务器未返回 WebDAV 目录。请检查地址是否指向 WebDAV 服务。', 'The server did not return a WebDAV listing. Check the service URL.'));
        const doc = new DOMParser().parseFromString(response.text, 'text/xml');
        if (doc.getElementsByTagNameNS('*', 'parsererror').length || doc.documentElement.localName !== 'multistatus' || doc.documentElement.namespaceURI !== 'DAV:') {
            throw new UserError(t('服务器目录响应无法解析。旧缓存已保留。', 'Cannot parse the server listing. The previous cache is preserved.'));
        }
        const text = (el: Element, name: string) => el.getElementsByTagNameNS('DAV:', name)[0]?.textContent || '';
        const files = new Map<string, WebDAVFile>();
        for (const res of Array.from(doc.documentElement.children).filter(el => el.localName === 'response')) {
            if (res.namespaceURI !== 'DAV:') throw new UserError(t('目录包含无法识别的文件响应。旧缓存已保留。', 'The listing contains an unrecognized file response. The previous cache is preserved.'));
            const href = text(res, 'href');
            if (!href) throw new Error('Missing WebDAV href');
            const props = Array.from(res.getElementsByTagNameNS('DAV:', 'propstat'))
                .filter(p => /\s200(?:\s|$)/.test(text(p, 'status')))
                .map(p => p.getElementsByTagNameNS('DAV:', 'prop')[0]).filter(Boolean);
            if (!props.length) throw new UserError(t('部分文件元数据不可读。旧缓存已保留，请检查目录权限后重试。', 'Some file metadata is unavailable. The previous cache is preserved. Check folder permissions and retry.'));
            const property = (name: string) => props.map(p => text(p, name)).find(Boolean) || '';
            const length = property('getcontentlength');
            const modified = property('getlastmodified');
            const file: WebDAVFile = {
                href: new URL(href, this.url).href,
                lastModified: Number.isFinite(Date.parse(modified)) ? modified : '',
                contentLength: /^\d+$/.test(length) && Number.isSafeInteger(Number(length)) ? Number(length) : -1,
                isCollection: props.some(p => p.getElementsByTagNameNS('DAV:', 'collection').length > 0)
            };
            const previous = files.get(file.href);
            if (previous && (previous.lastModified !== file.lastModified || previous.contentLength !== file.contentLength || previous.isCollection !== file.isCollection)) {
                throw new UserError(t('同一文件返回了冲突的元数据。旧缓存已保留，请重试。', 'The server returned conflicting metadata for one file. Previous cache retained; retry the refresh.'));
            }
            files.set(file.href, file);
        }
        return [...files.values()];
    }
    async getFileBuffer(href: string): Promise<ArrayBuffer> {
        return (await this.request(new URL(href, this.url).href, 'GET')).arrayBuffer;
    }
}
