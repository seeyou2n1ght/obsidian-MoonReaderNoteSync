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
        
        let headerIndex = -1;
        // 使用特征扫描：一条记录有17行，其中第0,4,6,8,9行必须是纯数字（可能包含负号）
        for (let i = 0; i <= lines.length - 17; i++) {
            const isNum = (offset: number) => /^-?\d+$/.test(lines[i + offset].trim());
            if (isNum(0) && isNum(4) && isNum(6) && isNum(8) && isNum(9)) {
                headerIndex = i;
                break;
            }
        }

        const notes: MoonReaderNote[] = [];
        if (headerIndex === -1) return notes;

        let idx = headerIndex;
        while (idx + 16 < lines.length) {
            const block = lines.slice(idx, idx + 17).map(l => l.trim());
            
            try {
                const annId = block[0];
                const bookName = block[1];
                const chapter = block[4];
                const colorInt = parseInt(block[8], 10);
                const tsMs = parseInt(block[9], 10);
                const note = block[11];
                const highlightText = block[12];
                
                let timestamp = "";
                if (!isNaN(tsMs) && tsMs > 0) {
                    const date = new Date(tsMs);
                    timestamp = date.toISOString().replace('T', ' ').substring(0, 19);
                }

                if (highlightText || note) {
                    notes.push({
                        bookName: bookName || "Unknown",
                        chapter: chapter,
                        highlightText: highlightText,
                        note: note,
                        colorHex: isNaN(colorInt) ? "#000000" : AnParser.argbToHex(colorInt.toString()),
                        timestamp: timestamp,
                        id: annId
                    });
                }
            } catch (e) {
                // Ignore parsing errors for individual blocks
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
