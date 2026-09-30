import { getLanguage } from 'obsidian';

// Prefer the host language API; the fallback also supports test hosts.
export function t(zh: string, en: string): string {
    const language = typeof getLanguage === 'function' ? getLanguage() : window.localStorage.getItem('language') || 'en';
    return language.startsWith('zh') ? zh : en;
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error && error.name === 'UserError') return error.message;
    const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
    if (status === 401 || status === 403) return t('身份验证失败或无访问权限。请检查账号、应用密码和目录权限。', 'Authentication or access denied. Check your account, app password and folder permissions.');
    if (status === 404) return t('找不到备份目录，请检查 WebDAV 地址。', 'Backup folder not found. Check the WebDAV URL.');
    return t('操作失败。请检查网络、服务器或本地文件访问权限后重试。', 'Operation failed. Check your network, server or local file permissions and retry.');
}

export class UserError extends Error {
    constructor(message: string) { super(message); this.name = 'UserError'; }
}
