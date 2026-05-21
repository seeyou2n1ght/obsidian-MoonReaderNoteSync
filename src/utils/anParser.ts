import pako from 'pako';

export interface MoonReaderNote {
    id: string;
    bookName: string;
    chapter: string;
    colorHex: string;
    timestamp: string;
    note: string;
    highlightText: string;
}

export class AnParser {
    public static parseBuffer(buffer: ArrayBuffer): MoonReaderNote[] {
        const str = this.inflateBuffer(buffer);
        const lines = str.split(/\r?\n/);
        
        let headerIndex = 0;
        for (let i = 0; i < Math.min(15, lines.length); i++) {
            if (lines[i].trim() === '#') {
                headerIndex = i + 1;
                break;
            }
        }

        const notes: MoonReaderNote[] = [];
        let idx = headerIndex;

        while (idx + 16 < lines.length) {
            const block = lines.slice(idx, idx + 17).map(l => l.trim());
            
            try {
                const annId = parseInt(block[0], 10);
                const bookName = block[1];
                const chapter = parseInt(block[4], 10);
                const offset = parseInt(block[6], 10);
                const length = parseInt(block[7], 10);
                const colorInt = parseInt(block[8], 10);
                const tsMs = parseInt(block[9], 10);
                
                if (isNaN(annId) || isNaN(chapter) || isNaN(offset) || isNaN(length) || isNaN(colorInt) || isNaN(tsMs)) {
                    throw new Error("Invalid numeric field");
                }

                const note = block[11];
                const highlightText = block[12];
                
                let timestamp = "";
                if (tsMs > 0) {
                    const date = new Date(tsMs);
                    timestamp = date.toISOString().replace('T', ' ').substring(0, 19);
                }

                if (highlightText || note) {
                    notes.push({
                        bookName: bookName || "Unknown",
                        chapter: chapter.toString(),
                        highlightText: highlightText,
                        note: note,
                        colorHex: AnParser.argbToHex(colorInt.toString()),
                        timestamp: timestamp,
                        id: annId.toString()
                    });
                }
            } catch (e) {
                // Defensive block skipping: isolates corrupted blocks
            }
            
            idx += 17;
        }
        
        return notes;
    }

    private static inflateBuffer(buffer: ArrayBuffer): string {
        try {
            return pako.inflate(new Uint8Array(buffer), { to: 'string' });
        } catch (e) {
            console.error("Failed to inflate .an file", e);
            return "";
        }
    }

    public static argbToHex(argbStr: string): string {
        const intVal = parseInt(argbStr, 10);
        if (isNaN(intVal)) return "#000000";
        // Convert to unsigned 32-bit
        const uval = intVal >>> 0;
        // Extract RGB
        const r = (uval >> 16) & 0xFF;
        const g = (uval >> 8) & 0xFF;
        const b = uval & 0xFF;
        return "#" + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }
}
