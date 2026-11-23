import { getLanguage } from 'obsidian';

export function t(zh: string, en: string): string {
    const language = getLanguage();
    return language.startsWith('zh') ? zh : en;
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error && error.name === 'UserError') return error.message;
    const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
    if (status === 401 || status === 403) return t('身份验证失败或无访问权限。请检查账号、应用密码和目录权限。', 'Authentication or access denied. Check your account, app password and folder permissions.');
    if (status === 404) return t('找不到备份目录，请检查 WebDAV 地址。', 'Backup folder not found. Check the WebDAV URL.');
    if (Number.isInteger(status) && status >= 400) {
        return t(`服务器返回错误（HTTP ${status}）。请检查服务器状态或 WebDAV 配置后重试。`, `Server returned an error (HTTP ${status}). Check the server or WebDAV settings and retry.`);
    }
    return t('操作失败。请检查网络、服务器或本地文件访问权限后重试。', 'Operation failed. Check your network, server or local file permissions and retry.');
}

export class UserError extends Error {
    constructor(message: string) { super(message); this.name = 'UserError'; }
}
