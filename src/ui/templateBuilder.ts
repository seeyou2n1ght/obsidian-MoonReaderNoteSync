import { App, MarkdownRenderer, Component } from 'obsidian';
import MoonReaderSyncPlugin from '../main';
import { MoonReaderNote } from '../utils/anParser';

export class TemplateBuilderUI {
    static build(containerEl: HTMLElement, app: App, plugin: MoonReaderSyncPlugin, initialTemplate: string, onChange: (value: string) => void) {
        const builderContainer = containerEl.createDiv({ cls: 'moonreader-template-builder' });
        
        // Ensure flex layout
        builderContainer.setCssStyles({ display: 'flex' });
        builderContainer.setCssStyles({ gap: '20px' });
        builderContainer.setCssStyles({ marginTop: '10px' });
        builderContainer.setCssStyles({ alignItems: 'flex-start' });

        // Left Panel: Draggable Fields
        const leftPanel = builderContainer.createDiv();
        leftPanel.setCssStyles({ flex: '0 0 130px' });
        leftPanel.setCssStyles({ display: 'flex' });
        leftPanel.setCssStyles({ flexDirection: 'column' });
        leftPanel.setCssStyles({ gap: '6px' });

        leftPanel.createEl('h4', { text: 'Available Fields' });
        leftPanel.createEl('small', { text: 'Drag or click', cls: 'setting-item-description' }).setCssStyles({ marginBottom: '4px' });

        const fields = [
            { id: '{bookName}', name: 'Book Name', desc: 'Title of the book' },
            { id: '{chapter}', name: 'Chapter', desc: 'Chapter name or index' },
            { id: '{highlightText}', name: 'Highlight', desc: 'The highlighted text' },
            { id: '{note}', name: 'Note', desc: 'Your personal note' },
            { id: '{color}', name: 'Color (Hex)', desc: 'Highlight color in #RRGGBB' },
            { id: '{timestamp}', name: 'Timestamp', desc: 'Time of highlight' },
            { id: '{id}', name: 'ID', desc: 'Unique annotation ID' }
        ];

        let currentTemplate = initialTemplate;
        
        // Right Panel: Editor and Preview
        const rightPanel = builderContainer.createDiv();
        rightPanel.setCssStyles({ flex: '1 1 auto' });
        rightPanel.setCssStyles({ display: 'flex' });
        rightPanel.setCssStyles({ flexDirection: 'column' });
        rightPanel.setCssStyles({ gap: '15px' });

        rightPanel.createEl('h4', { text: 'Template Editor' });
        
        const textArea = rightPanel.createEl('textarea', { cls: 'moonreader-template-textarea' });
        textArea.setCssStyles({ width: '100%' });
        textArea.setCssStyles({ minHeight: '150px' });
        textArea.setCssStyles({ fontFamily: 'monospace' });
        textArea.setCssStyles({ resize: 'vertical' });
        textArea.setCssStyles({ padding: '8px' });
        textArea.value = currentTemplate;

        // Preview Area
        rightPanel.createEl('h4', { text: 'Live Preview' });
        const previewEl = rightPanel.createDiv({ cls: 'moonreader-template-preview markdown-rendered' });
        previewEl.setCssStyles({ border: '1px solid var(--background-modifier-border)' });
        previewEl.setCssStyles({ padding: '15px' });
        previewEl.setCssStyles({ borderRadius: '4px' });
        previewEl.setCssStyles({ minHeight: '100px' });
        previewEl.setCssStyles({ backgroundColor: 'var(--background-primary)' });

        const dummyNote: MoonReaderNote = {
            id: '12345678',
            bookName: 'Obsidian Plugins Guide',
            chapter: 'Chapter 4: Advanced WebDAV',
            highlightText: 'This is a sample highlighted text from the book.',
            note: 'This is my personal thought on this highlight.',
            colorHex: '#FFEB3B',
            timestamp: '2026-05-21 12:00:00'
        };

        const updatePreview = () => {
            currentTemplate = textArea.value;
            onChange(currentTemplate);
            
            const renderedText = plugin.renderNotes([dummyNote], currentTemplate);
            previewEl.empty();
            
            // We use MarkdownRenderer to provide a real Obsidian preview
            // A dummy component is needed for the renderer
            const component = new Component();
            void MarkdownRenderer.render(app, renderedText, previewEl, '', component);
        };

        textArea.addEventListener('input', updatePreview);

        // Populate fields
        fields.forEach(f => {
            const fieldEl = leftPanel.createDiv({ cls: 'moonreader-field-pill' });
            fieldEl.setCssStyles({ padding: '4px 8px' });
            fieldEl.setCssStyles({ backgroundColor: 'var(--background-secondary)' });
            fieldEl.setCssStyles({ border: '1px solid var(--background-modifier-border)' });
            fieldEl.setCssStyles({ borderRadius: '4px' });
            fieldEl.setCssStyles({ cursor: 'grab' });
            fieldEl.setCssStyles({ userSelect: 'none' });
            fieldEl.setCssStyles({ textAlign: 'center' });
            fieldEl.setCssStyles({ color: 'var(--text-muted)' });
            fieldEl.title = f.name + ": " + f.desc; // 榧犳爣鎮诞鏃舵樉绀烘彁绀?            
            fieldEl.createEl('strong', { text: f.id }).setCssStyles({ fontSize: '0.9em' });

            // Make draggable
            fieldEl.draggable = true;
            
            fieldEl.addEventListener('dragstart', (e) => {
                if (e.dataTransfer) {
                    e.dataTransfer.setData('text/plain', f.id);
                    e.dataTransfer.effectAllowed = 'copy';
                }
            });

            // Click to insert at cursor
            fieldEl.addEventListener('click', () => {
                const startPos = textArea.selectionStart;
                const endPos = textArea.selectionEnd;
                
                const textBefore = textArea.value.substring(0, startPos);
                const textAfter = textArea.value.substring(endPos, textArea.value.length);
                
                textArea.value = textBefore + f.id + textAfter;
                
                // Move cursor after inserted text
                textArea.selectionStart = textArea.selectionEnd = startPos + f.id.length;
                textArea.focus();
                
                updatePreview();
            });
        });

        // Initial preview render
        updatePreview();
    }
}
