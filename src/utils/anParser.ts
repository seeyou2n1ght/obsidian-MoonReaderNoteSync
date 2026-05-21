import pako from 'pako';

export interface MoonReaderNote {
    id: string;
    bookName: string;
    originalPath: string;
    lowerPath: string;
    chapter: string;
    paraOffset: string;
    globalOffset: string;
    highlightLength: string;
    colorARGB: string;
    colorHex: string;
    timestamp: string;
    note: string;
    highlightText: string;
}

export class AnParser {
    public static parseBuffer(buffer: ArrayBuffer): MoonReaderNote[] {
        try {
            // MoonReader .an files are typically zlib compressed.
            const inflated = pako.inflate(new Uint8Array(buffer), { to: 'string' });
            return this.parseText(inflated);
        } catch (e) {
            console.error("Failed to inflate .an file", e);
            return [];
        }
    }

    public static parseText(text: string): MoonReaderNote[] {
        // MoonReader .an uses CRLF or LF, let's split by newline and remove carriage returns
        const lines = text.split(/\r?\n/);
        const notes: MoonReaderNote[] = [];
        
        // Each record is 17 lines
        for (let i = 0; i < lines.length; i += 17) {
            // Check if we have enough lines for a full record
            // Some files might end with fewer empty lines if not perfectly padded, but let's assume 17.
            // Minimum required to get highlight is 13 lines.
            if (i + 12 >= lines.length) break;
            
            const id = lines[i] || "";
            const bookName = lines[i+1] || "";
            if (!id && !bookName) continue; // skip completely empty trailing lines
            
            const originalPath = lines[i+2] || "";
            const lowerPath = lines[i+3] || "";
            const chapter = lines[i+4] || "";
            const paraOffset = lines[i+5] || "";
            const globalOffset = lines[i+6] || "";
            const highlightLength = lines[i+7] || "";
            const colorARGB = lines[i+8] || "0";
            const timestamp = lines[i+9] || "0";
            // lines[i+10] is reserved
            const note = lines[i+11] || "";
            const highlightText = lines[i+12] || "";
            // lines 14-16 are statuses, line 17 is separator
            
            const colorHex = this.argbToHex(colorARGB);
            
            notes.push({
                id,
                bookName,
                originalPath,
                lowerPath,
                chapter,
                paraOffset,
                globalOffset,
                highlightLength,
                colorARGB,
                colorHex,
                timestamp,
                note,
                highlightText
            });
        }
        
        return notes;
    }

    public static parseBookNameOnly(buffer: ArrayBuffer): string | null {
        try {
            // We just need the first few lines to get the book name (line 2)
            // It's zlib compressed so we inflate the whole thing or chunks
            const inflated = pako.inflate(new Uint8Array(buffer), { to: 'string' });
            const lines = inflated.split(/\r?\n/, 3);
            if (lines.length > 1) {
                return lines[1];
            }
            return null;
        } catch(e) {
            return null;
        }
    }

    private static argbToHex(argbStr: string): string {
        const intVal = parseInt(argbStr, 10);
        if (isNaN(intVal)) return "#000000";
        // Convert to unsigned 32-bit
        const uval = intVal >>> 0;
        // Extract RGB
        const r = (uval >> 16) & 0xFF;
        const g = (uval >> 8) & 0xFF;
        const b = uval & 0xFF;
        // Optionally extract A if needed, but we return standard HTML Hex
        return "#" + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }
}
