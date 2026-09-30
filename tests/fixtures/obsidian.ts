// Minimal host for controlled UI tests. This is not an Obsidian emulator.
declare global { interface HTMLElement {
    createEl(tag: string, options?: any): any; createDiv(options?: any): any;
    addClass(name: string): void; empty(): void; setText(text: string): void;
} }
HTMLElement.prototype.createEl = function(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.cls) el.className = options.cls;
    if (options.text) el.textContent = options.text;
    for (const [key, value] of Object.entries(options.attr || {})) el.setAttribute(key, String(value));
    this.append(el); return el;
};
HTMLElement.prototype.createDiv = function(options = {}) { return this.createEl('div', options); };
HTMLElement.prototype.addClass = function(name) { this.classList.add(name); };
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
HTMLElement.prototype.setText = function(text) { this.textContent = text; };
export const getLanguage = () => new URLSearchParams(location.search).get('lang') || 'zh';
export const normalizePath = (path: string) => path.replaceAll('\\', '/');
export class Component {
    children: Component[] = []; loaded = false;
    addChild<T extends Component>(child: T): T { this.children.push(child); if (this.loaded) child.load(); return child; }
    removeChild(child: Component) { child.unload(); this.children = this.children.filter(c => c !== child); }
    load() { this.loaded = true; (this as any).onload?.(); this.children.forEach(c => { if (!c.loaded) c.load(); }); }
    unload() { this.loaded = false; this.children.forEach(c => c.unload()); (this as any).onunload?.(); }
}
export class Modal {
    modalEl = document.createElement('section');
    contentEl: HTMLElement;
    titleEl: HTMLElement;
    previousFocus = document.activeElement as HTMLElement;
    constructor(public app: any) {
        this.modalEl.className = 'modal'; this.modalEl.setAttribute('role', 'dialog');
        this.titleEl = this.modalEl.createEl('h2');
        this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
        this.modalEl.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.close(); } });
    }
    setTitle(value: string) { this.titleEl.setText(value); }
    open() { document.body.append(this.modalEl); (this as any).onOpen?.(); }
    close() { this.modalEl.remove(); (this as any).onClose?.(); this.previousFocus?.focus(); }
}
export class SuggestModal<T> extends Modal {
    inputEl: HTMLInputElement; resultContainerEl: HTMLElement;
    constructor(app: any) {
        super(app);
        this.inputEl = this.contentEl.createDiv().createEl('input');
        this.resultContainerEl = this.contentEl.createDiv();
        this.inputEl.addEventListener('input', () => this.update());
        this.inputEl.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); const item = (this as any).getSuggestions(this.inputEl.value)[0]; if (item) { this.close(); (this as any).onChooseSuggestion(item, event); } }
        });
    }
    setPlaceholder(text: string) { this.inputEl.placeholder = text; }
    setInstructions(values: any[]) { this.contentEl.createDiv({ text: values.map(v => v.command + ' ' + v.purpose).join(' · '), cls: 'moonreader-meta' }); }
    update() {
        this.resultContainerEl.empty();
        const items = (this as any).getSuggestions(this.inputEl.value);
        if (!items.length) { (this as any).onNoSuggestion?.(); return; }
        items.forEach((item: any) => {
            const row = this.resultContainerEl.createDiv(); row.tabIndex = 0;
            (this as any).renderSuggestion(item, row);
            row.addEventListener('click', event => { this.close(); (this as any).onChooseSuggestion(item, event); });
        });
    }
    onOpen() { this.update(); this.inputEl.focus(); }
    onClose() {}
}
export class ButtonComponent {
    buttonEl: HTMLButtonElement;
    constructor(el: HTMLElement) { this.buttonEl = el.createEl('button'); }
    setButtonText(text: string) { this.buttonEl.textContent = text; return this; }
    setCta() { this.buttonEl.classList.add('mod-cta'); return this; }
    setIcon(icon: string) { this.buttonEl.dataset.icon = icon; this.buttonEl.textContent = ({ 'refresh-cw': '↻', settings: '⚙' } as Record<string, string>)[icon] || '⋯'; return this; }
    setTooltip(text: string) { this.buttonEl.title = text; this.buttonEl.setAttribute('aria-label', text); return this; }
    setDisabled(disabled: boolean) { this.buttonEl.disabled = disabled; return this; }
    onClick(fn: any) { this.buttonEl.addEventListener('click', fn); return this; }
}
export class Notice {
    constructor(text: string) { document.body.createDiv({ cls: 'notice', text, attr: { role: 'status' } }); }
}
export class Menu {
    el = document.createElement('div');
    constructor() { this.el.className = 'menu'; this.el.setAttribute('role', 'menu'); }
    addItem(callback: (item: any) => void) {
        const button = this.el.createEl('button', { attr: { role: 'menuitem' } });
        const item = {
            setTitle(text: string) { button.textContent = text; return item; },
            setIcon(_icon: string) { return item; },
            setChecked(value: boolean) { button.setAttribute('aria-checked', String(value)); return item; },
            setDisabled(value: boolean) { button.disabled = value; return item; },
            onClick: (fn: () => void) => { button.onclick = () => { this.hide(); fn(); }; return item; }
        };
        callback(item); return this;
    }
    addSeparator() { this.el.createEl('hr'); return this; }
    showAtPosition(_position: { x: number; y: number }) {
        document.body.append(this.el);
        return this;
    }
    hide() { this.el.remove(); }
}
export class DropdownComponent {
    selectEl: HTMLSelectElement;
    constructor(el: HTMLElement) { this.selectEl = el.createEl('select'); }
    addOption(value: string, text: string) { const option = new Option(text, value); this.selectEl.add(option); return this; }
    setValue(value: string) { this.selectEl.value = value; return this; }
    onChange(fn: any) { this.selectEl.addEventListener('change', () => fn(this.selectEl.value)); return this; }
}
export class TextComponent {
    inputEl: HTMLInputElement;
    constructor(el: HTMLElement) { this.inputEl = el.createEl('input', { attr: { type: 'text' } }); }
    setValue(value: string) { this.inputEl.value = value; return this; }
    setPlaceholder(value: string) { this.inputEl.placeholder = value; return this; }
    onChange(fn: any) { this.inputEl.addEventListener('input', () => fn(this.inputEl.value)); return this; }
}
export class PluginSettingTab {
    containerEl = document.createElement('div');
    constructor(public app: any, _plugin: any) {}
    getSettingDefinitions(): any[] { return []; }
    display() {
        this.containerEl.empty();
        const render = (definitions: any[], container: HTMLElement, parentGroup?: SettingGroup) => {
            for (const definition of definitions) {
                if (definition.type === 'group') {
                    const group = new SettingGroup(container).setHeading(definition.heading || '');
                    if (definition.cls) group.listEl.addClass(definition.cls);
                    render(definition.items || [], group.listEl, group);
                } else {
                    const setting = new Setting(container).setName(definition.name).setDesc(definition.desc || '');
                    definition.render?.(setting, parentGroup || new SettingGroup(container));
                }
            }
        };
        render(this.getSettingDefinitions(), this.containerEl);
    }
}
export class Setting {
    settingEl: HTMLElement; controlEl: HTMLElement; label: HTMLElement;
    constructor(el: HTMLElement) {
        this.settingEl = el.createDiv({ cls: 'setting-item' });
        this.label = this.settingEl.createDiv({ cls: 'setting-item-info' });
        this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
    }
    setName(name: string) { this.label.setText(name); this.controlEl.querySelectorAll('input,select').forEach(el => el.setAttribute('aria-label', name)); return this; }
    setDesc(desc: string) { this.label.createDiv({ cls: 'moonreader-meta', text: desc }); return this; }
    setHeading() { this.settingEl.addClass('setting-item-heading'); return this; }
    addButton(fn: any) { fn(new ButtonComponent(this.controlEl)); return this; }
    addText(fn: any) { const text = new TextComponent(this.controlEl); text.inputEl.setAttribute('aria-label', this.label.textContent || ''); fn(text); return this; }
    addDropdown(fn: any) { const d = new DropdownComponent(this.controlEl); d.selectEl.setAttribute('aria-label', this.label.textContent || ''); fn(d); return this; }
}
export class MarkdownView {}
export class SettingGroup {
    listEl: HTMLElement;
    constructor(container: HTMLElement) { this.listEl = container.createDiv(); }
    setHeading(text: string) { new Setting(this.listEl).setName(text).setHeading(); return this; }
}
export class TFile {}
export const MarkdownRenderer = { async render(_app: unknown, text: string, el: HTMLElement) {
    // Only representative blockquote rendering; real Markdown renderer still needs host QA.
    for (const line of text.split('\n').filter(Boolean)) {
        const block = el.createEl(line.startsWith('>') ? 'blockquote' : 'p');
        block.innerHTML = line.replace(/^>\s?/, '').replace(/\s\^\d+$/, '');
    }
} };
// Replaced with real loopback HTTP requests in tests/helpers.mjs.
export async function requestUrl(_options: unknown) { throw new Error('Configure an explicit HTTP test handler'); }
